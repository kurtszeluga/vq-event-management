import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch
} from 'firebase/firestore';
import { auth } from '../lib/firebase.js';
import { db } from '../lib/firebase.js';

const registrationsCollection = () => collection(db, 'registrations');
const paymentsCollection = () => collection(db, 'payments');
const auditLogsCollection = () => collection(db, 'auditLogs');

export function subscribeToRegistrations(onNext, onError) {
  const registrationsQuery = query(registrationsCollection(), orderBy('registrationDate', 'desc'));
  return onSnapshot(registrationsQuery, onNext, onError);
}

export function subscribeToUserRegistrations(userId, onNext, onError) {
  if (!userId) {
    return () => {};
  }

  const registrationsQuery = query(
    registrationsCollection(),
    where('userId', '==', userId)
  );

  return onSnapshot(registrationsQuery, onNext, onError);
}

export function subscribeToPayments(onNext, onError) {
  const paymentsQuery = query(paymentsCollection(), orderBy('createdDate', 'desc'));
  return onSnapshot(paymentsQuery, onNext, onError);
}

export function subscribeToRegistrationPayments(registrationId, onNext, onError) {
  if (!registrationId) {
    return () => {};
  }

  const paymentsQuery = query(
    paymentsCollection(),
    where('registrationId', '==', registrationId)
  );

  return onSnapshot(paymentsQuery, onNext, onError);
}

export async function lookupRegistrationEmail(email, eventId = '') {
  const idToken = await getMatchingUserIdToken(email);
  const response = await fetch('/api/registration-lookup', {
    body: JSON.stringify({ email, eventId }),
    headers: {
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Email lookup failed.');
  }

  return result;
}

export async function createRegistration(registrationData) {
  const idToken = await getMatchingUserIdToken(registrationData.email);
  const response = await fetch('/api/create-registration', {
    body: JSON.stringify(registrationData),
    headers: {
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Registration could not be completed.');
  }

  return result;
}

export async function loadSquarePaymentConfig() {
  const response = await fetch('/api/create-registration', {
    body: JSON.stringify({ action: 'squareConfig' }),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Payment setup could not be loaded.');
  }

  return result;
}

export async function beginSquareReservation(registrationData) {
  const idToken = await getMatchingUserIdToken(registrationData.email);
  const response = await fetch('/api/create-registration', {
    body: JSON.stringify({
      ...registrationData,
      action: 'beginSquareReservation'
    }),
    headers: {
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Payment seat hold could not be created.');
  }

  return result;
}

export async function sendMembershipConfirmation(kind = 'signup') {
  const idToken = await auth?.currentUser?.getIdToken();

  if (!idToken) {
    throw new Error('Sign in again before sending the membership confirmation.');
  }

  const response = await fetch('/api/create-registration', {
    body: JSON.stringify({
      action: 'sendMembershipConfirmation',
      kind
    }),
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Membership confirmation email could not be sent.');
  }

  return result;
}

export async function startRegistrationEmailVerification(email, eventId = '') {
  const response = await fetch('/api/registration-lookup', {
    body: JSON.stringify({
      action: 'startEmailVerification',
      email,
      eventId
    }),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Verification email could not be sent.');
  }

  return result;
}

export async function verifyRegistrationEmailCode({ challengeId, code, email, eventId = '' }) {
  const response = await fetch('/api/registration-lookup', {
    body: JSON.stringify({
      action: 'verifyEmailCode',
      challengeId,
      code,
      email,
      eventId
    }),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Email verification failed.');
  }

  return result;
}

export async function loadPublicRegistrationCounts(eventIds = []) {
  const targetEventIds = eventIds.filter(Boolean);

  if (!targetEventIds.length) {
    return {};
  }

  const params = new URLSearchParams({
    eventIds: targetEventIds.join(',')
  });
  const response = await fetch(`/api/public-registration-counts?${params.toString()}`);
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Registration counts could not be loaded.');
  }

  return result.counts || {};
}

export async function updateRegistrationStatus(registrationId, status, actorProfile) {
  const registrationRef = doc(db, 'registrations', registrationId);
  const registrationSnap = await getDoc(registrationRef);

  if (!registrationSnap.exists()) {
    throw new Error('Registration record could not be found.');
  }

  const before = registrationSnap.data();
  const batch = writeBatch(db);

  batch.update(registrationRef, { status });
  batch.set(doc(auditLogsCollection()), {
    action: status === 'Cancelled' ? 'Cancel' : 'Update',
    actorEmail: actorProfile?.email || '',
    actorName: actorProfile?.name || actorProfile?.email || 'Unknown Admin',
    actorRole: actorProfile?.role || '',
    actorUserId: actorProfile?.userId || actorProfile?.id || '',
    after: { status },
    before,
    createdDate: serverTimestamp(),
    entityId: registrationId,
    entityType: 'Registration',
    summary: `Updated registration "${before.name || before.email || registrationId}" to ${status}`
  });

  return batch.commit();
}

export async function updateRegistrationPayment(registrationId, paymentData) {
  const idToken = await auth?.currentUser?.getIdToken();

  if (!idToken) {
    throw new Error('You must be signed in to update registration payments.');
  }

  const response = await fetch('/api/admin-update-registration-payment', {
    body: JSON.stringify({
      ...paymentData,
      registrationId
    }),
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Payment could not be updated.');
  }

  return result;
}

async function parseJsonResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const bodyText = await response.text();

  if (contentType.includes('application/json')) {
    try {
      return bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return { error: bodyText || 'Unexpected server response.' };
    }
  }

  if (!bodyText) {
    return {};
  }

  try {
    return JSON.parse(bodyText);
  } catch {
    return { error: bodyText };
  }
}

async function getMatchingUserIdToken(email) {
  const currentUser = auth?.currentUser;

  if (!currentUser || normalizeEmail(currentUser.email) !== normalizeEmail(email)) {
    return '';
  }

  return currentUser.getIdToken();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
