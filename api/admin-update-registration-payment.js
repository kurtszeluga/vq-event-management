import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';

const PAYMENT_METHODS = ['', 'Online', 'Cash', 'Check', 'Comped'];
const PAYMENT_STATUSES = ['Pending', 'Paid', 'Refunded', 'Failed', 'Waived', 'No Charge'];
const REGISTRATION_STATUSES = ['Pending Payment', 'Registered', 'Cancelled', 'Waitlisted'];

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
    const statusUpdate = getStatusUpdateForPayment({
      requestedStatus: request.body?.status,
      before,
      paymentUpdate
    });
    const now = FieldValue.serverTimestamp();
    const updatePayload = {
      ...paymentUpdate,
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
      status: statusUpdate.status || before.status || '',
      registrationId
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Payment could not be updated.'
    });
  }
}

function sanitizeRegistrationStatus(status, registration) {
  const nextStatus = cleanText(status);

  if (!nextStatus) {
    return {};
  }

  if (!REGISTRATION_STATUSES.includes(nextStatus)) {
    throw new Error('Choose a valid registration status.');
  }

  if (nextStatus === (registration.status || 'Registered')) {
    return {};
  }

  return { status: nextStatus };
}

function getStatusUpdateForPayment({ requestedStatus, before, paymentUpdate }) {
  const explicitStatusUpdate = sanitizeRegistrationStatus(requestedStatus, before);

  if (explicitStatusUpdate.status) {
    return explicitStatusUpdate;
  }

  if (
    ['Paid', 'Waived'].includes(paymentUpdate.paymentStatus)
    && before.status === 'Pending Payment'
  ) {
    return { status: 'Registered' };
  }

  if (
    paymentUpdate.paymentStatus === 'Refunded'
    && before.status === 'Registered'
  ) {
    return { status: 'Cancelled' };
  }

  return {};
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
  const isOnlinePayment = registration?.paymentStatus === 'Paid'
    && registration?.paymentMethod === 'Online';

  if (isOnlinePayment) {
    if (paymentStatus === 'Paid') {
      return {
        amountPaid: Number(registration.amountPaid || 0),
        paymentMethod: 'Online',
        paymentNote,
        paymentStatus: 'Paid'
      };
    }

    if (paymentStatus !== 'Refunded') {
      throw new Error('Online Square payments can only be marked refunded.');
    }

    if (!paymentNote) {
      throw new Error('Enter refund details: when, who approved it, and why.');
    }

    return {
      amountPaid: Number(registration.amountPaid || 0),
      paymentMethod: 'Online',
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
  statusUpdate
}) {
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
    note: paymentUpdate.paymentNote || '',
    paymentId,
    processor: paymentUpdate.paymentMethod === 'Online' ? 'Square' : 'Manual',
    registrationId,
    registrationStatus: statusUpdate.status || before.status || '',
    squareTransactionId: before.squareTransactionId || '',
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
