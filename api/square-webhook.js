import crypto from 'node:crypto';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { initializeAdminApp } from './_lib/public-event-feed.js';

const REGISTRATION_PAID_UPDATE = {
  paymentMethod: 'Online',
  paymentNote: 'Paid online through Square.',
  paymentPreference: 'online',
  paymentStatus: 'Paid',
  status: 'Registered'
};

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const rawBody = await getRawRequestBody(request);
    const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY || '';
    const notificationUrl = getNotificationUrl(request);
    const receivedSignature = getSquareSignature(request);

    if (!signatureKey) {
      response.status(500).json({
        code: 'missing_square_signature_key',
        error: 'Square webhook signature key is not configured.'
      });
      return;
    }

    if (!rawBody) {
      response.status(400).json({
        code: 'missing_body',
        error: 'Square webhook request body was empty.'
      });
      return;
    }

    if (!verifySquareSignature({
      notificationUrl,
      rawBody,
      receivedSignature,
      signatureKey
    })) {
      response.status(403).json({
        code: 'invalid_square_signature',
        error: 'Invalid Square webhook signature.'
      });
      return;
    }

    const event = parseWebhookEvent(rawBody);

    initializeAdminApp();
    await recordSquareWebhookEvent(getFirestore(), event, request);
    response.status(200).json({ received: true });
  } catch (error) {
    console.error('Square webhook failed', error);
    response.status(error.statusCode || 500).json({
      code: error.code || 'square_webhook_failed',
      error: error.message || 'Square webhook failed.'
    });
  }
}

async function recordSquareWebhookEvent(db, event, request) {
  const eventId = cleanText(event.event_id || event.id || '');
  const eventType = cleanText(event.type || '');
  const eventRef = db.collection('squareWebhookEvents').doc(
    eventId || hashWebhookEvent(event)
  );
  const existingEventSnap = await eventRef.get();

  if (existingEventSnap.exists && existingEventSnap.data().processedAt) {
    return;
  }

  const squareObject = event.data?.object || {};
  const payment = squareObject.payment || null;
  const refund = squareObject.refund || null;
  const batch = db.batch();

  batch.set(eventRef, {
    createdAt: cleanText(event.created_at || ''),
    eventId,
    eventType,
    merchantId: cleanText(event.merchant_id || ''),
    objectId: cleanText(payment?.id || refund?.id || squareObject.id || ''),
    objectType: cleanText(event.data?.type || ''),
    receivedAt: FieldValue.serverTimestamp(),
    squareEnvironment: cleanText(request.headers['square-environment'] || ''),
    status: 'Received'
  }, { merge: true });

  const reconciliation = payment
    ? await buildPaymentReconciliation(db, payment)
    : refund
      ? await buildRefundReconciliation(db, refund)
      : null;

  if (reconciliation) {
    applyReconciliation(batch, reconciliation);
  }

  batch.set(eventRef, {
    processedAt: FieldValue.serverTimestamp(),
    ...buildWebhookEventSummary(reconciliation),
    reviewDetails: reconciliation?.webhookOnly || {},
    reconciliationStatus: reconciliation?.status || 'No Action',
    status: 'Processed'
  }, { merge: true });

  await batch.commit();
}

async function buildPaymentReconciliation(db, squarePayment) {
  const squarePaymentId = cleanText(squarePayment.id || '');
  const squareStatus = cleanText(squarePayment.status || '');
  const registrationId = cleanText(squarePayment.reference_id || '');

  if (!squarePaymentId) {
    return null;
  }

  const registrationRef = registrationId
    ? db.collection('registrations').doc(registrationId)
    : null;
  const registrationSnap = registrationRef ? await registrationRef.get() : null;
  const registration = registrationSnap?.exists ? registrationSnap.data() : null;
  const paymentDocs = await findPaymentDocs(db, {
    registrationId,
    squareTransactionId: squarePaymentId
  });
  const paymentDoc = paymentDocs[0] || null;
  const payment = paymentDoc?.data() || null;
  const context = buildPaymentContext({ payment, registration, registrationId });

  if (!registrationRef || !registrationSnap?.exists || !paymentDoc) {
    return {
      context,
      status: 'Needs Review',
      webhookOnly: {
        registrationId,
        squarePaymentId,
        squareStatus
      }
    };
  }

  if (squareStatus === 'COMPLETED') {
    const amountPaid = getSquareAmount(squarePayment.total_money || squarePayment.amount_money);

    return {
      context,
      paymentRef: paymentDoc.ref,
      registrationRef,
      registrationUpdate: {
        ...REGISTRATION_PAID_UPDATE,
        amountPaid,
        paymentUpdatedDate: FieldValue.serverTimestamp(),
        squareTransactionId: squarePaymentId
      },
      paymentUpdate: {
        amount: amountPaid,
        method: 'Online',
        note: 'Paid online through Square.',
        processor: 'Square',
        registrationStatus: 'Registered',
        squareTransactionId: squarePaymentId,
        status: 'Paid',
        updatedRegistrationSnapshot: {
          amountPaid,
          paymentMethod: 'Online',
          paymentPreference: 'online',
          paymentStatus: 'Paid',
          status: 'Registered'
        }
      },
      status: 'Payment Completed'
    };
  }

  if (['CANCELED', 'FAILED'].includes(squareStatus)) {
    return {
      context,
      paymentRef: paymentDoc.ref,
      registrationRef,
      registrationUpdate: {
        paymentMethod: 'Online',
        paymentNote: `Square payment ${squareStatus.toLowerCase()}.`,
        paymentStatus: 'Failed',
        paymentUpdatedDate: FieldValue.serverTimestamp(),
        squareTransactionId: squarePaymentId,
        status: 'Cancelled'
      },
      paymentUpdate: {
        method: 'Online',
        note: `Square payment ${squareStatus.toLowerCase()}.`,
        processor: 'Square',
        registrationStatus: 'Cancelled',
        squareTransactionId: squarePaymentId,
        status: 'Failed',
        updatedRegistrationSnapshot: {
          amountPaid: 0,
          paymentMethod: 'Online',
          paymentPreference: 'online',
          paymentStatus: 'Failed',
          status: 'Cancelled'
        }
      },
      status: 'Payment Failed'
    };
  }

  return {
    context,
    status: 'No Action'
  };
}

async function buildRefundReconciliation(db, squareRefund) {
  const squarePaymentId = cleanText(squareRefund.payment_id || '');
  const refundStatus = cleanText(squareRefund.status || '');

  if (!squarePaymentId || refundStatus !== 'COMPLETED') {
    return null;
  }

  const paymentDocs = await findPaymentDocs(db, { squareTransactionId: squarePaymentId });
  const paymentDoc = paymentDocs[0] || null;
  const payment = paymentDoc?.data() || null;
  const registrationId = cleanText(payment?.registrationId || '');
  const registrationRef = registrationId ? db.collection('registrations').doc(registrationId) : null;
  const registrationSnap = registrationRef ? await registrationRef.get() : null;
  const registration = registrationSnap?.exists ? registrationSnap.data() : null;
  const context = buildPaymentContext({ payment, registration, registrationId });

  if (!paymentDoc || !registrationId) {
    return {
      context,
      status: 'Needs Review',
      webhookOnly: {
        squarePaymentId,
        squareRefundId: cleanText(squareRefund.id || '')
      }
    };
  }

  const refundAmount = getSquareAmount(squareRefund.amount_money);
  const recordedPaymentAmount = Number(payment?.amount || 0);

  if (recordedPaymentAmount && refundAmount < recordedPaymentAmount) {
    return {
      context,
      status: 'Partial Refund Needs Review',
      webhookOnly: {
        recordedPaymentAmount,
        refundAmount,
        squarePaymentId,
        squareRefundId: cleanText(squareRefund.id || '')
      }
    };
  }

  return {
    context,
    paymentRef: paymentDoc.ref,
    registrationRef,
    registrationUpdate: {
      amountPaid: 0,
      paymentMethod: 'Online',
      paymentNote: buildRefundNote(squareRefund),
      paymentStatus: 'Refunded',
      paymentUpdatedDate: FieldValue.serverTimestamp(),
      status: 'Cancelled'
    },
    paymentUpdate: {
      amount: refundAmount,
      method: 'Online',
      note: buildRefundNote(squareRefund),
      processor: 'Square',
      registrationStatus: 'Cancelled',
      status: 'Refunded',
      updatedRegistrationSnapshot: {
        amountPaid: 0,
        paymentMethod: 'Online',
        paymentPreference: 'online',
        paymentStatus: 'Refunded',
        status: 'Cancelled'
      }
    },
    status: 'Refund Completed'
  };
}

function buildWebhookEventSummary(reconciliation) {
  const context = reconciliation?.context || {};

  return {
    eventTitle: cleanText(context.eventTitle || ''),
    registrationEmail: cleanText(context.registrationEmail || ''),
    registrationId: cleanText(context.registrationId || ''),
    registrationName: cleanText(context.registrationName || '')
  };
}

function buildPaymentContext({ payment = {}, registration = {}, registrationId = '' }) {
  return {
    eventTitle: cleanText(registration?.eventTitle || payment?.eventTitle || ''),
    registrationEmail: cleanText(registration?.email || payment?.createdByEmail || ''),
    registrationId: cleanText(registrationId || registration?.registrationId || payment?.registrationId || ''),
    registrationName: cleanText(registration?.name || payment?.createdByName || '')
  };
}

function applyReconciliation(batch, reconciliation) {
  if (reconciliation.registrationRef && reconciliation.registrationUpdate) {
    batch.update(reconciliation.registrationRef, reconciliation.registrationUpdate);
  }

  if (reconciliation.paymentRef && reconciliation.paymentUpdate) {
    batch.update(reconciliation.paymentRef, reconciliation.paymentUpdate);
  }
}

async function findPaymentDocs(db, { registrationId = '', squareTransactionId = '' }) {
  if (squareTransactionId) {
    const squareSnapshot = await db
      .collection('payments')
      .where('squareTransactionId', '==', squareTransactionId)
      .limit(2)
      .get();

    if (!squareSnapshot.empty) {
      return squareSnapshot.docs;
    }
  }

  if (!registrationId) {
    return [];
  }

  const registrationSnapshot = await db
    .collection('payments')
    .where('registrationId', '==', registrationId)
    .limit(5)
    .get();

  return registrationSnapshot.docs;
}

function verifySquareSignature({
  notificationUrl,
  rawBody,
  receivedSignature,
  signatureKey
}) {
  if (!receivedSignature || !signatureKey || !notificationUrl || !rawBody) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', signatureKey)
    .update(notificationUrl + rawBody)
    .digest('base64');
  const receivedBuffer = Buffer.from(receivedSignature, 'base64');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64');

  return receivedBuffer.length === expectedBuffer.length
    && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

async function getRawRequestBody(request) {
  if (Buffer.isBuffer(request.body)) {
    return request.body.toString('utf8');
  }

  if (typeof request.body === 'string') {
    return request.body;
  }

  if (request.body && typeof request.body === 'object') {
    return JSON.stringify(request.body);
  }

  const chunks = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString('utf8');
}

function parseWebhookEvent(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch {
    const error = new Error('Square webhook request body was not valid JSON.');

    error.code = 'invalid_json_body';
    error.statusCode = 400;
    throw error;
  }
}

function getSquareSignature(request) {
  return cleanText(
    request.headers['x-square-hmacsha256-signature']
      || request.headers['x-square-signature']
      || ''
  );
}

function getNotificationUrl(request) {
  if (process.env.SQUARE_WEBHOOK_NOTIFICATION_URL) {
    return process.env.SQUARE_WEBHOOK_NOTIFICATION_URL;
  }

  const host = request.headers['x-forwarded-host'] || request.headers.host;
  const protocol = request.headers['x-forwarded-proto'] || 'https';

  return `${protocol}://${host}/api/square-webhook`;
}

function getSquareAmount(amountMoney = {}) {
  return Number(amountMoney.amount || 0) / 100;
}

function buildRefundNote(squareRefund) {
  const reason = cleanText(squareRefund.reason || '');
  const refundId = cleanText(squareRefund.id || '');

  return [
    'Refund confirmed by Square.',
    refundId ? `Refund ID: ${refundId}.` : '',
    reason ? `Reason: ${reason}.` : ''
  ].filter(Boolean).join(' ');
}

function hashWebhookEvent(event) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(event))
    .digest('hex');
}

function cleanText(value) {
  return String(value || '').trim();
}
