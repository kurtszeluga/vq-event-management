import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';
import { enforceRateLimit } from './_lib/rate-limit.js';

const PAYMENT_METHODS = ['', 'Online', 'Cash', 'Check', 'Comped'];
const PAYMENT_STATUSES = ['Pending', 'Paid', 'Refund Pending', 'Refunded', 'Failed', 'Waived', 'No Charge'];

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
      await enforceAdminPaymentRateLimit(db, request, actorUid, 'resolvePaymentReview');
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
    await enforceAdminPaymentRateLimit(db, request, actorUid, 'updateRegistrationPayment', request.body || {});

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
      ? { squareRefundId: squareRefund.id || '', squareTransactionId: squareRefund.payment_id }
      : {};
    const effectivePaymentUpdate = squareRefund?.status === 'PENDING'
      ? {
          ...paymentUpdate,
          paymentNote: `${paymentUpdate.paymentNote} Square refund id: ${squareRefund.id || 'Pending'}.`.trim(),
          paymentStatus: 'Refund Pending'
        }
      : paymentUpdate;
    const effectiveStatusUpdate = getStatusUpdateForPayment({
      before,
      paymentUpdate: effectivePaymentUpdate
    });
    const updatePayload = {
      ...effectivePaymentUpdate,
      ...squareTransactionUpdate,
      ...effectiveStatusUpdate,
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
      paymentUpdate: effectivePaymentUpdate,
      registrationId,
      squareRefund,
      statusUpdate: effectiveStatusUpdate
    }));
    batch.set(db.collection('auditLogs').doc(), {
      action: getAuditAction(paymentUpdate, statusUpdate),
      actorEmail: actorProfile.email || '',
      actorName: actorProfile.name || actorProfile.email || 'Unknown Admin',
      actorRole: actorProfile.role || '',
      actorUserId: actorProfile.userId || actorUid,
      after: {
        ...effectivePaymentUpdate,
        squareRefundId: squareRefund?.id || '',
        ...squareTransactionUpdate,
        ...effectiveStatusUpdate,
        paymentUpdatedDate: null
      },
      before,
      createdDate: now,
      entityId: registrationId,
      entityType: 'Registration',
      summary: buildAuditSummary(before, registrationId, effectivePaymentUpdate, effectiveStatusUpdate)
    });

    await batch.commit();

    if (shouldSendRefundNotification({
      paymentUpdate: effectivePaymentUpdate,
      registration: before,
      statusUpdate: effectiveStatusUpdate
    })) {
      const updatedRegistration = {
        ...before,
        ...effectivePaymentUpdate,
        ...squareTransactionUpdate,
        ...effectiveStatusUpdate
      };

      await withTimeout(
        sendRefundNotificationEmail(db, {
          actorProfile,
          registration: updatedRegistration,
          squareRefund
        }),
        4000,
        'Refund notification email timed out'
      ).catch((emailError) => {
        console.error('Refund notification email failed', emailError);
      });
    }

    response.status(200).json({
      payment: effectivePaymentUpdate,
      squareRefund: squareRefund ? {
        id: squareRefund.id || '',
        status: squareRefund.status || ''
      } : null,
      status: effectiveStatusUpdate.status || before.status || '',
      registrationId
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Payment could not be updated.'
    });
  }
}

async function enforceAdminPaymentRateLimit(db, request, actorUid, action, payload = {}) {
  const tenMinutes = 10 * 60 * 1000;
  const oneHour = 60 * 60 * 1000;
  const registrationId = cleanText(payload.registrationId);

  await enforceRateLimit(db, {
    keyParts: [actorUid, action],
    limit: action === 'resolvePaymentReview' ? 60 : 40,
    message: 'Too many admin payment updates. Please wait and try again later.',
    request,
    scope: 'admin-payment-update-ip-user',
    windowMs: tenMinutes
  });

  if (payload.paymentStatus === 'Refunded') {
    await enforceRateLimit(db, {
      keyParts: [actorUid],
      limit: 8,
      message: 'Too many refund requests. Please wait and try again later.',
      scope: 'admin-square-refund-user',
      windowMs: oneHour
    });
    await enforceRateLimit(db, {
      keyParts: [registrationId],
      limit: 3,
      message: 'Too many refund requests for this registration. Please wait and review the payment history.',
      scope: 'admin-square-refund-registration',
      windowMs: oneHour
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

  if (refund.status === 'PENDING') {
    await db.collection('squareWebhookEvents').doc(`refund-pending-${refund.id || registrationId}`).set({
      createdAt: '',
      eventId: '',
      eventTitle: before.eventTitle || '',
      eventType: 'App Initiated Refund',
      merchantId: '',
      objectId: refund.id || '',
      objectType: 'refund',
      processedAt: FieldValue.serverTimestamp(),
      receivedAt: FieldValue.serverTimestamp(),
      reconciliationStatus: 'Refund Pending Needs Review',
      registrationEmail: before.email || '',
      registrationId,
      registrationName: before.name || '',
      reviewDetails: {
        message: 'Square accepted the refund request. Waiting for Square refund webhook completion.',
        squarePaymentId,
        squareRefundId: refund.id || '',
        squareRefundStatus: refund.status
      },
      squareEnvironment: getSquareEnvironment(),
      status: 'Processed'
    }, { merge: true });

    return {
      ...refund,
      payment_id: squarePaymentId
    };
  }

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

  if (paymentStatus === 'Refund Pending') {
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

  if (paymentUpdate.paymentStatus === 'Refund Pending') {
    return 'Update';
  }

  if (paymentUpdate.paymentStatus === 'Paid' || paymentUpdate.paymentStatus === 'Waived') {
    return 'Pay';
  }

  return 'Update';
}

function shouldSendRefundNotification({ paymentUpdate, registration, statusUpdate }) {
  const nextStatus = statusUpdate.status || registration.status || '';

  return ['Refunded', 'Refund Pending'].includes(paymentUpdate.paymentStatus)
    && nextStatus === 'Cancelled'
    && Boolean(cleanText(registration.email));
}

async function sendRefundNotificationEmail(db, {
  actorProfile,
  registration,
  squareRefund
}) {
  const emailSettingsSnap = await db.collection('appSettings').doc('emailInstructions').get();
  const emailSettings = emailSettingsSnap.exists ? emailSettingsSnap.data() : {};

  if (emailSettings.sendRegistrationConfirmations !== true) {
    return;
  }

  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY is not configured. Skipping refund notification email.');
    return;
  }

  const area = getEmailInstructionArea(registration.eventType);
  const coordinatorContact = await getCoordinatorContact(db, area.areaId);
  const replyTo = coordinatorContact.email || actorProfile.email || '';
  const subject = `Village Quilters Registration Cancelled: ${registration.eventTitle || registration.eventType || 'Event'}`;

  await sendResendEmail({
    html: buildRefundNotificationHtml({
      coordinatorContact,
      registration,
      squareRefund
    }),
    replyTo,
    subject,
    text: buildRefundNotificationText({
      coordinatorContact,
      registration,
      squareRefund
    }),
    to: registration.email
  });
}

async function sendResendEmail({ html, replyTo, subject, text, to }) {
  const from = process.env.RESEND_FROM_EMAIL || 'The Village Quilters <no-reply@villagequilters.com>';
  const payload = {
    from,
    html,
    subject,
    text,
    to: [to]
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const resendResponse = await fetch('https://api.resend.com/emails', {
    body: JSON.stringify(payload),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const textResponse = await resendResponse.text();
  const result = textResponse ? safeJsonParse(textResponse) : {};

  if (!resendResponse.ok) {
    const message = result.message || result.error || 'Resend could not send the refund notification email.';
    const error = new Error(message);

    error.statusCode = resendResponse.status;
    throw error;
  }

  return result;
}

function buildRefundNotificationHtml({ coordinatorContact, registration, squareRefund }) {
  const logoUrl = `${getAppOrigin()}/assets/village-quilters-logo.png`;
  const eventTitle = registration.eventTitle || registration.eventType || 'Event';
  const refundStatus = getRefundStatusText(registration, squareRefund);
  const contactHtml = buildCoordinatorContactHtml(coordinatorContact);

  return `<!doctype html>
<html>
  <body style="margin:0;background:#f3eee8;color:#1d2927;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" style="width:100%;border-collapse:collapse;background:#f3eee8;padding:28px 0;">
      <tr>
        <td align="center">
          <table role="presentation" style="width:100%;max-width:680px;border-collapse:collapse;background:#fffdfa;border:1px solid #ded5ca;border-radius:8px;overflow:hidden;">
            <tr>
              <td style="padding:24px 28px;background:#225c56;color:#fffaf5;">
                <table role="presentation" style="width:100%;border-collapse:collapse;">
                  <tr>
                    <td style="width:58px;vertical-align:middle;">
                      <img alt="Village Quilters" src="${escapeHtml(logoUrl)}" width="48" height="48" style="display:block;border-radius:10px;" />
                    </td>
                    <td style="vertical-align:middle;">
                      <p style="margin:0 0 5px;color:#f3c6a8;font-size:13px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;">The Village Quilters, Inc.</p>
                      <h1 style="margin:0;color:#fffaf5;font-size:24px;line-height:1.25;">Registration Cancelled</h1>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 28px;">
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">Hello ${escapeHtml(registration.name || registration.email)},</p>
                <p style="margin:0 0 18px;font-size:16px;line-height:1.55;">Your registration has been cancelled. The payment refund status is shown below.</p>
                <section style="margin:0 0 18px;padding:16px;border:1px solid #e3d9ce;background:#fbf8f3;">
                  <h2 style="margin:0 0 12px;color:#225c56;font-size:19px;line-height:1.3;">${escapeHtml(eventTitle)}</h2>
                  ${buildDetailRowHtml('Registration Status', registration.status || 'Cancelled')}
                  ${buildDetailRowHtml('Refund Status', refundStatus)}
                  ${buildDetailRowHtml('Event Date', formatEventDate(registration.eventDate))}
                  ${buildDetailRowHtml('Amount', formatCurrency(registration.amountPaid || registration.amountDue || 0))}
                  ${registration.squareRefundId ? buildDetailRowHtml('Square Refund ID', registration.squareRefundId) : ''}
                </section>
                ${contactHtml}
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#225c56;color:#fffaf5;">
                <p style="margin:0;color:#fffaf5;font-size:13px;line-height:1.5;">The Village Quilters, Inc.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function buildRefundNotificationText({ coordinatorContact, registration, squareRefund }) {
  return [
    'The Village Quilters, Inc. Registration Cancelled',
    '',
    `Hello ${registration.name || registration.email},`,
    '',
    'Your registration has been cancelled. The payment refund status is shown below.',
    '',
    `Event: ${registration.eventTitle || registration.eventType || 'Event'}`,
    `Registration Status: ${registration.status || 'Cancelled'}`,
    `Refund Status: ${getRefundStatusText(registration, squareRefund)}`,
    `Event Date: ${formatEventDate(registration.eventDate)}`,
    `Amount: ${formatCurrency(registration.amountPaid || registration.amountDue || 0)}`,
    registration.squareRefundId ? `Square Refund ID: ${registration.squareRefundId}` : '',
    ...buildCoordinatorContactText(coordinatorContact)
  ].filter((line) => line !== '').join('\n');
}

function getRefundStatusText(registration, squareRefund) {
  if (registration.paymentStatus === 'Refund Pending') {
    return squareRefund?.status
      ? `Refund submitted to Square. Square status: ${squareRefund.status}.`
      : 'Refund submitted and pending completion.';
  }

  if (registration.paymentStatus === 'Refunded') {
    return squareRefund?.status
      ? `Refund completed. Square status: ${squareRefund.status}.`
      : 'Refund recorded.';
  }

  return registration.paymentStatus || 'Refund status unavailable';
}

async function getCoordinatorContact(db, areaId) {
  const snapshot = await db.collection('coordinatorAssignments').doc(areaId).get();

  if (!snapshot.exists) {
    return { email: '', name: '' };
  }

  const assignment = snapshot.data();

  if (assignment.isActive === false) {
    return { email: '', name: '' };
  }

  return {
    email: cleanText(assignment.contactEmailOverride || assignment.assignedUserEmail),
    name: cleanText(assignment.assignedUserName)
  };
}

function buildCoordinatorContactHtml(contact = {}) {
  const name = cleanText(contact.name);
  const email = cleanText(contact.email);

  if (!name && !email) {
    return '';
  }

  return `
                <section style="margin:0 0 18px;padding:16px;border:1px solid #d6e3df;background:#f2f8f6;">
                  <h2 style="margin:0 0 8px;color:#225c56;font-size:17px;line-height:1.3;">For questions contact:</h2>
                  ${name ? `<p style="margin:0 0 6px;font-size:15px;line-height:1.45;"><strong style="color:#1d2927;">Name:</strong> ${escapeHtml(name)}</p>` : ''}
                  ${email ? `<p style="margin:0;font-size:15px;line-height:1.45;"><strong style="color:#1d2927;">Email:</strong> <a href="mailto:${escapeHtml(email)}" style="color:#225c56;font-weight:700;">${escapeHtml(email)}</a></p>` : ''}
                </section>`;
}

function buildCoordinatorContactText(contact = {}) {
  const name = cleanText(contact.name);
  const email = cleanText(contact.email);

  if (!name && !email) {
    return [];
  }

  return [
    '',
    'For questions contact:',
    name ? `Name: ${name}` : '',
    email ? `Email: ${email}` : ''
  ].filter(Boolean);
}

function getEmailInstructionArea(eventType) {
  if (['Class (Half Day)', 'Class (Full Day)', 'Class (Half-Day)', 'Class (Full-Day)', 'Lecture', 'Retreat'].includes(eventType)) {
    return { areaId: 'programs', areaLabel: 'Programs' };
  }

  if (eventType === 'Workshop') {
    return { areaId: 'workshops', areaLabel: 'Workshops' };
  }

  if (eventType === 'Challenges') {
    return { areaId: 'challenges', areaLabel: 'Challenges' };
  }

  return { areaId: 'programs', areaLabel: 'Programs' };
}

function buildDetailRowHtml(label, value) {
  return `<p style="margin:0 0 8px;font-size:15px;line-height:1.45;"><strong style="color:#1d2927;">${escapeHtml(label)}:</strong> ${escapeHtml(value || '')}</p>`;
}

function formatEventDate(value) {
  if (!value) {
    return 'Date TBD';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-');
    return `${month}/${day}/${year}`;
  }

  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat('en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).format(parsed);
}

function formatCurrency(value) {
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency'
  }).format(Number(value || 0));
}

function getAppOrigin() {
  return process.env.APP_ORIGIN
    || process.env.VERCEL_PROJECT_PRODUCTION_URL && `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    || process.env.VERCEL_URL && `https://${process.env.VERCEL_URL}`
    || 'https://vq-event-management.vercel.app';
}

function withTimeout(promise, timeoutMs, timeoutMessage) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    })
  ]);
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
  return typeof value === 'string' ? value.trim() : '';
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
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
