import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';

const PAYMENT_METHODS = ['', 'Online', 'Cash', 'Check', 'Comped'];
const PAYMENT_STATUSES = ['Pending', 'Paid', 'Refunded', 'Failed', 'Waived', 'No Charge'];

let firebaseProjectId = '';

function initializeAdminApp() {
  const existingApp = getApps()[0];

  if (existingApp) {
    firebaseProjectId = existingApp.options.projectId || firebaseProjectId;
    return existingApp;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  const serviceAccount = parseServiceAccountJson(serviceAccountJson);
  firebaseProjectId = serviceAccount.project_id;

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: firebaseProjectId
  });
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    initializeAdminApp();

    const idToken = getBearerToken(request);

    if (!idToken) {
      response.status(401).json({ error: 'Missing authorization token.' });
      return;
    }

    const db = getFirestore();
    const decodedToken = await verifyFirebaseIdToken(idToken, firebaseProjectId);
    const actorUid = decodedToken.user_id || decodedToken.sub || decodedToken.uid;

    if (!actorUid) {
      response.status(401).json({ error: 'Invalid authorization token.' });
      return;
    }

    const actorSnap = await db.collection('users').doc(actorUid).get();
    const actorProfile = actorSnap.exists ? actorSnap.data() : {};

    if (!canUpdateRegistrationPayments(actorProfile)) {
      response.status(403).json({ error: 'This account cannot update registration payments.' });
      return;
    }

    if (request.body?.action === 'resolvePaymentReview') {
      await resolvePaymentReview({
        actorProfile,
        actorUid,
        db,
        decodedToken,
        request,
        response
      });
      return;
    }

    const registrationId = cleanText(request.body?.registrationId);

    if (!registrationId) {
      response.status(400).json({ error: 'Registration ID is required.' });
      return;
    }

    const registrationRef = db.collection('registrations').doc(registrationId);
    const registrationSnap = await registrationRef.get();

    if (!registrationSnap.exists) {
      response.status(404).json({ error: 'Registration record could not be found.' });
      return;
    }

    const before = registrationSnap.data();
    const paymentUpdate = sanitizePaymentUpdate(request.body || {}, before);
    const statusUpdate = getStatusUpdateForPayment({ before, paymentUpdate });
    const squareRefund = await processSquareRefundIfNeeded(db, {
      actorProfile,
      before,
      paymentUpdate,
      registrationId
    });
    const now = FieldValue.serverTimestamp();
    const squareTransactionUpdate = squareRefund?.payment_id
      ? { squareTransactionId: squareRefund.payment_id }
      : {};
    const updatePayload = {
      ...paymentUpdate,
      ...squareTransactionUpdate,
      ...statusUpdate,
      paymentUpdatedDate: now
    };
    const batch = db.batch();
    const paymentRef = db.collection('payments').doc();

    batch.update(registrationRef, updatePayload);
    batch.set(paymentRef, buildPaymentRecord({
      actorProfile,
      actorUid,
      before,
      paymentId: paymentRef.id,
      paymentUpdate,
      registrationId,
      squareRefund,
      statusUpdate
    }));
    batch.set(db.collection('auditLogs').doc(), {
      action: getAuditAction(paymentUpdate, statusUpdate),
      actorEmail: actorProfile.email || '',
      actorName: actorProfile.name || actorProfile.email || 'Unknown Admin',
      actorRole: actorProfile.role || '',
      actorUserId: actorProfile.userId || actorUid,
      after: {
        ...paymentUpdate,
        squareRefundId: squareRefund?.id || '',
        ...squareTransactionUpdate,
        ...statusUpdate,
        paymentUpdatedDate: null
      },
      before,
      createdDate: now,
      entityId: registrationId,
      entityType: 'Registration',
      summary: buildAuditSummary(before, registrationId, paymentUpdate, statusUpdate)
    });

    await batch.commit();

    response.status(200).json({
      payment: paymentUpdate,
      squareRefund: squareRefund ? {
        id: squareRefund.id || '',
        status: squareRefund.status || ''
      } : null,
      status: statusUpdate.status || before.status || '',
      registrationId
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Payment could not be updated.'
    });
  }
}

async function processSquareRefundIfNeeded(db, {
  actorProfile,
  before,
  paymentUpdate,
  registrationId
}) {
  const isOnlinePaidRefund = before.paymentStatus === 'Paid'
    && before.paymentMethod === 'Online'
    && paymentUpdate.paymentStatus === 'Refunded';

  if (!isOnlinePaidRefund) {
    return null;
  }

  const paymentSettings = await getPaymentSettings(db);

  if (!paymentSettings.allowAppInitiatedRefunds) {
    return null;
  }

  const squarePaymentId = await getSquarePaymentIdForRegistration(db, before, registrationId);

  if (!squarePaymentId) {
    throw httpError(400, 'This registration does not have a Square payment id to refund.');
  }

  const refundAmount = Number(before.amountPaid || before.amountDue || 0);

  if (refundAmount <= 0) {
    throw httpError(400, 'This registration does not have a positive paid amount to refund.');
  }

  const refund = await createSquareRefund({
    amount: refundAmount,
    paymentId: squarePaymentId,
    reason: buildSquareRefundReason(paymentUpdate.paymentNote, actorProfile),
    registrationId
  });

  if (refund.status !== 'COMPLETED') {
    await db.collection('squareWebhookEvents').doc(`refund-review-${refund.id || registrationId}`).set({
      createdAt: '',
      eventId: '',
      eventTitle: before.eventTitle || '',
      eventType: 'App Initiated Refund',
      merchantId: '',
      objectId: refund.id || '',
      objectType: 'refund',
      processedAt: FieldValue.serverTimestamp(),
      receivedAt: FieldValue.serverTimestamp(),
      reconciliationStatus: 'Refund Needs Review',
      registrationEmail: before.email || '',
      registrationId,
      registrationName: before.name || '',
      reviewDetails: {
        message: 'Square accepted the refund request but did not return COMPLETED.',
        squarePaymentId,
        squareRefundId: refund.id || '',
        squareRefundStatus: refund.status || 'Unknown'
      },
      squareEnvironment: getSquareEnvironment(),
      status: 'Processed'
    }, { merge: true });

    throw httpError(
      409,
      `Square refund status is ${refund.status || 'not complete'}. The registration was not marked refunded.`
    );
  }

  return {
    ...refund,
    payment_id: squarePaymentId
  };
}

async function getSquarePaymentIdForRegistration(db, registration, registrationId) {
  const squarePaymentId = cleanText(registration.squareTransactionId);

  if (squarePaymentId) {
    return squarePaymentId;
  }

  const paymentSnapshot = await db
    .collection('payments')
    .where('registrationId', '==', registrationId)
    .where('processor', '==', 'Square')
    .where('status', '==', 'Paid')
    .limit(1)
    .get();

  if (paymentSnapshot.empty) {
    return '';
  }

  return cleanText(paymentSnapshot.docs[0].data().squareTransactionId);
}

async function getPaymentSettings(db) {
  const snapshot = await db.collection('appSettings').doc('paymentSettings').get();

  return {
    allowAppInitiatedRefunds: snapshot.exists
      && snapshot.data().allowAppInitiatedRefunds === true
  };
}

async function createSquareRefund({
  amount,
  paymentId,
  reason,
  registrationId
}) {
  const accessToken = process.env.SQUARE_ACCESS_TOKEN || '';

  if (!accessToken) {
    throw httpError(500, 'Square access token is not configured.');
  }

  const endpoint = getSquareEnvironment() === 'production'
    ? 'https://connect.squareup.com/v2/refunds'
    : 'https://connect.squareupsandbox.com/v2/refunds';
  const response = await fetch(endpoint, {
    body: JSON.stringify({
      amount_money: {
        amount: Math.round(Number(amount || 0) * 100),
        currency: 'USD'
      },
      idempotency_key: `registration-refund-${registrationId}-${paymentId}`,
      payment_id: paymentId,
      reason
    }),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Square-Version': '2026-05-20'
    },
    method: 'POST'
  });
  const result = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw httpError(response.status, getSquareRefundError(result));
  }

  return result.refund || {};
}

function getSquareEnvironment() {
  return process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';
}

function buildSquareRefundReason(paymentNote, actorProfile) {
  const actorName = actorProfile.name || actorProfile.email || 'Admin';
  const reason = `${cleanText(paymentNote)} Processed by ${actorName}.`.trim();

  return reason.slice(0, 192);
}

function getSquareRefundError(result) {
  const errors = result?.errors || [];
  const message = errors
    .map((error) => error.detail || error.message)
    .filter(Boolean)
    .join(' ');

  return message || 'Square refund could not be completed.';
}

function httpError(statusCode, message) {
  const error = new Error(message);

  error.statusCode = statusCode;
  return error;
}

async function resolvePaymentReview({
  actorProfile,
  actorUid,
  db,
  decodedToken,
  request,
  response
}) {
  const reviewId = cleanText(request.body?.reviewId);
  const resolutionNote = cleanText(request.body?.resolutionNote);

  if (!reviewId) {
    response.status(400).json({ error: 'Payment review ID is required.' });
    return;
  }

  if (!resolutionNote) {
    response.status(400).json({ error: 'Enter a short note explaining how this item was reviewed.' });
    return;
  }

  const reviewRef = db.collection('squareWebhookEvents').doc(reviewId);
  const reviewSnap = await reviewRef.get();

  if (!reviewSnap.exists) {
    response.status(404).json({ error: 'Payment review item could not be found.' });
    return;
  }

  await reviewRef.update({
    resolvedAt: FieldValue.serverTimestamp(),
    resolvedByEmail: actorProfile.email || decodedToken.email || '',
    resolvedByName: actorProfile.name || actorProfile.email || decodedToken.email || 'Admin',
    resolvedByUserId: actorProfile.userId || actorUid,
    resolutionNote,
    reconciliationStatus: 'Reviewed',
    status: 'Reviewed'
  });

  response.status(200).json({ status: 'Reviewed' });
}

function getStatusUpdateForPayment({ before, paymentUpdate }) {
  const nextStatus = getRegistrationStatusForPayment(before, paymentUpdate.paymentStatus);

  if (!nextStatus || nextStatus === (before.status || 'Registered')) {
    return {};
  }

  return { status: nextStatus };
}

function getRegistrationStatusForPayment(registration, paymentStatus) {
  if (paymentStatus === 'Refunded' || paymentStatus === 'Failed') {
    return 'Cancelled';
  }

  if (registration?.status === 'Waitlisted' && paymentStatus === 'Pending') {
    return 'Waitlisted';
  }

  if (['Pending', 'Paid', 'Waived', 'No Charge'].includes(paymentStatus)) {
    return 'Registered';
  }

  return '';
}

function buildAuditSummary(before, registrationId, paymentUpdate, statusUpdate) {
  const name = before.name || before.email || registrationId;
  const changes = [];

  if (statusUpdate.status) {
    changes.push(`status to ${statusUpdate.status}`);
  }

  if (paymentUpdate.paymentStatus !== (before.paymentStatus || 'Pending')) {
    changes.push(`payment to ${paymentUpdate.paymentStatus}`);
  }

  if (!changes.length) {
    changes.push(`payment details to ${paymentUpdate.paymentStatus}`);
  }

  return `Updated registration "${name}" ${changes.join(' and ')}`;
}

function getAuditAction(paymentUpdate, statusUpdate) {
  if (statusUpdate.status === 'Cancelled') {
    return 'Cancel';
  }

  if (paymentUpdate.paymentStatus === 'Refunded') {
    return 'Refund';
  }

  if (paymentUpdate.paymentStatus === 'Paid' || paymentUpdate.paymentStatus === 'Waived') {
    return 'Pay';
  }

  return 'Update';
}

function getBearerToken(request) {
  const authHeader = request.headers.authorization || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';
}

function canUpdateRegistrationPayments(actorProfile) {
  if (actorProfile.status !== 'Active') {
    return false;
  }

  if (actorProfile.role === 'Super User') {
    return true;
  }

  return actorProfile.role === 'Admin'
    && (
      actorProfile.permissions?.viewRegistrations === true
      || actorProfile.permissions?.managePayments === true
    );
}

function sanitizePaymentUpdate(payload, registration) {
  const paymentMethod = PAYMENT_METHODS.includes(payload.paymentMethod)
    ? payload.paymentMethod
    : '';
  const paymentStatus = PAYMENT_STATUSES.includes(payload.paymentStatus)
    ? payload.paymentStatus
    : 'Pending';
  const paymentNote = cleanText(payload.paymentNote);
  const isPaidPayment = registration?.paymentStatus === 'Paid';

  if (isPaidPayment) {
    if (paymentStatus === 'Paid') {
      return {
        amountPaid: Number(registration.amountPaid || 0),
        paymentMethod: registration.paymentMethod === 'None' ? '' : registration.paymentMethod || '',
        paymentNote: registration.paymentNote || '',
        paymentStatus: 'Paid'
      };
    }

    if (paymentStatus !== 'Refunded') {
      throw new Error('Paid registrations can only be marked refunded.');
    }

    if (!paymentNote) {
      throw new Error('Enter refund details: when, who approved it, and why.');
    }

    return {
      amountPaid: Number(registration.amountPaid || 0),
      paymentMethod: registration.paymentMethod === 'None' ? '' : registration.paymentMethod || '',
      paymentNote,
      paymentStatus: 'Refunded'
    };
  }

  if (paymentStatus === 'Pending') {
    return {
      amountPaid: 0,
      paymentMethod: '',
      paymentNote,
      paymentStatus: 'Pending'
    };
  }

  if (paymentStatus === 'No Charge') {
    if (Number(registration.amountDue || 0) > 0) {
      throw new Error('No Charge can only be used for registrations with no amount due.');
    }

    return {
      amountPaid: 0,
      paymentMethod: '',
      paymentNote,
      paymentStatus: 'No Charge'
    };
  }

  if (paymentStatus === 'Waived') {
    return {
      amountPaid: 0,
      paymentMethod: 'Comped',
      paymentNote,
      paymentStatus: 'Waived'
    };
  }

  if (paymentStatus === 'Refunded') {
    if (!paymentNote) {
      throw new Error('Enter refund details: when, who approved it, and why.');
    }

    return {
      amountPaid: Number(registration.amountPaid || 0),
      paymentMethod: registration.paymentMethod === 'None' ? '' : registration.paymentMethod || '',
      paymentNote,
      paymentStatus: 'Refunded'
    };
  }

  if (paymentStatus === 'Paid') {
    if (!['Cash', 'Check'].includes(paymentMethod)) {
      throw new Error('Manual paid registrations must use Cash or Check.');
    }

    const amountPaid = Number(payload.amountPaid || 0);

    if (amountPaid <= 0) {
      throw new Error('Enter the amount received for a cash or check payment.');
    }

    return {
      amountPaid,
      paymentMethod,
      paymentNote,
      paymentStatus: 'Paid'
    };
  }

  return {
    amountPaid: Number(payload.amountPaid || 0),
    paymentMethod,
    paymentNote,
    paymentStatus
  };
}

function buildPaymentRecord({
  actorProfile,
  actorUid,
  before,
  paymentId,
  paymentUpdate,
  registrationId,
  squareRefund,
  statusUpdate
}) {
  const squareRefundId = squareRefund?.id || '';

  return {
    amount: Number(paymentUpdate.amountPaid || 0),
    amountDue: Number(before.amountDue || 0),
    createdBy: actorProfile.userId || actorUid,
    createdByEmail: actorProfile.email || '',
    createdByName: actorProfile.name || actorProfile.email || 'Unknown Admin',
    createdDate: FieldValue.serverTimestamp(),
    entityId: registrationId,
    entityType: 'Registration',
    eventId: before.eventId || '',
    method: paymentUpdate.paymentMethod || '',
    note: squareRefundId
      ? `${paymentUpdate.paymentNote || ''} Square refund id: ${squareRefundId}.`.trim()
      : paymentUpdate.paymentNote || '',
    paymentId,
    processor: paymentUpdate.paymentMethod === 'Online' ? 'Square' : 'Manual',
    registrationId,
    registrationStatus: statusUpdate.status || before.status || '',
    squareRefundId,
    squareTransactionId: before.squareTransactionId || squareRefund?.payment_id || '',
    status: paymentUpdate.paymentStatus || 'Pending',
    userId: before.userId || '',
    updatedRegistrationSnapshot: {
      amountPaid: Number(paymentUpdate.amountPaid || 0),
      paymentMethod: paymentUpdate.paymentMethod || '',
      paymentStatus: paymentUpdate.paymentStatus || 'Pending',
      status: statusUpdate.status || before.status || ''
    }
  };
}

function cleanText(value) {
  return String(value || '').trim();
}

function parseServiceAccountJson(serviceAccountJson) {
  const trimmed = String(serviceAccountJson || '').trim();

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    try {
      return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
    } catch {
      throw new Error(`Unable to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message}`);
    }
  }
}
