import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';

const PAYMENT_METHODS = ['None', 'Online', 'Cash', 'Check', 'Comped'];
const PAYMENT_STATUSES = ['Pending', 'Paid', 'Refunded', 'Failed', 'Waived'];

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
    const now = FieldValue.serverTimestamp();
    const updatePayload = {
      ...paymentUpdate,
      paymentUpdatedDate: now
    };
    const batch = db.batch();

    batch.update(registrationRef, updatePayload);
    batch.set(db.collection('auditLogs').doc(), {
      action: paymentUpdate.paymentStatus === 'Refunded' ? 'Refund' : 'Pay',
      actorEmail: actorProfile.email || '',
      actorName: actorProfile.name || actorProfile.email || 'Unknown Admin',
      actorRole: actorProfile.role || '',
      actorUserId: actorProfile.userId || actorUid,
      after: {
        ...paymentUpdate,
        paymentUpdatedDate: null
      },
      before,
      createdDate: now,
      entityId: registrationId,
      entityType: 'Registration',
      summary: `Updated payment for "${before.name || before.email || registrationId}" to ${paymentUpdate.paymentStatus}`
    });

    await batch.commit();

    response.status(200).json({
      payment: paymentUpdate,
      registrationId
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Payment could not be updated.'
    });
  }
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
    : 'None';
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
      paymentMethod: 'None',
      paymentNote,
      paymentStatus: 'Pending'
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
      paymentMethod: registration.paymentMethod || 'None',
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
