import {
  collection,
  doc,
  getDoc,
  getDocs,
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
const squareWebhookEventsCollection = () => collection(db, 'squareWebhookEvents');

export function subscribeToRegistrations(onNext, onError) {
  const registrationsQuery = query(registrationsCollection(), orderBy('registrationDate', 'desc'));
  return onSnapshot(registrationsQuery, onNext, onError);
}

// One-time fetch (not a subscription) for the standalone registration-list
// print page reached via a coordinator email link - that page has no other
// state to keep live-updated once it renders. Firestore rules already scope
// this to admins with viewRegistrations (or the registrant's own record), so
// no extra permission check is required here.
export async function getRegistrationsForEvent(eventId) {
  if (!eventId) {
    return [];
  }

  const registrationsQuery = query(registrationsCollection(), where('eventId', '==', eventId));
  const snapshot = await getDocs(registrationsQuery);

  return snapshot.docs.map((registrationDoc) => ({ id: registrationDoc.id, ...registrationDoc.data() }));
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

export function subscribeToSquareWebhookEvents(onNext, onError) {
  const webhookEventsQuery = query(squareWebhookEventsCollection(), orderBy('receivedAt', 'desc'));
  return onSnapshot(webhookEventsQuery, onNext, onError);
}

export async function resolvePaymentReviewItem(reviewId, resolutionNote) {
  const currentUser = auth.currentUser;

  if (!currentUser) {
    throw new Error('You must be signed in to resolve payment review items.');
  }

  const idToken = await currentUser.getIdToken();
  const response = await fetch('/api/admin-update-registration-payment', {
    body: JSON.stringify({ action: 'resolvePaymentReview', resolutionNote, reviewId }),
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Payment review item could not be resolved.');
  }

  return result;
}

export function subscribeToRegistrationPayments(registrationId, userId, onNext, onError) {
  if (!registrationId) {
    return () => {};
  }

  const paymentConstraints = [
    where('entityType', '==', 'Registration'),
    where('registrationId', '==', registrationId)
  ];

  if (userId) {
    paymentConstraints.push(where('userId', '==', userId));
  }

  const paymentsQuery = query(paymentsCollection(), ...paymentConstraints);

  return onSnapshot(paymentsQuery, onNext, onError);
}

// Membership-type payments carry no userId field - only entityId, set to the
// member's own users/{uid} document ID at write time
// (buildMembershipPaymentRecord() in admin-update-user-profile.js). Firestore
// rules gate a self-read on entityId === auth uid to match.
export function subscribeToMembershipPayments(userId, onNext, onError) {
  if (!userId) {
    return () => {};
  }

  const paymentsQuery = query(
    paymentsCollection(),
    where('entityType', '==', 'Membership'),
    where('entityId', '==', userId)
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

// Deliberately does not use getMatchingUserIdToken - that helper only
// forwards a token when the signed-in user's own email equals the
// registrant's, which is never true here (the admin is registering someone
// else). This always sends the signed-in admin's own identity; the server
// re-derives and re-checks their permission from their own stored profile,
// never from anything this payload claims.
export async function createAdminRegistration(registrationData) {
  const idToken = await auth?.currentUser?.getIdToken();

  if (!idToken) {
    throw new Error('You must be signed in to register a member.');
  }

  const response = await fetch('/api/create-registration', {
    body: JSON.stringify({ ...registrationData, action: 'adminRegister' }),
    headers: {
      Authorization: `Bearer ${idToken}`,
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
    throw new Error(result.error || 'Seat hold could not be created.');
  }

  return result;
}

// Best-effort - a registrant backing out on Cancel shouldn't be blocked by a
// release call failing, so callers fire this and move on rather than await
// error handling the way the other registration calls do.
export function releaseReservation(reservationId, reservationToken) {
  if (!reservationId || !reservationToken) {
    return Promise.resolve();
  }

  return fetch('/api/create-registration', {
    body: JSON.stringify({
      action: 'releaseReservation',
      reservationId,
      reservationToken
    }),
    headers: {
      'Content-Type': 'application/json'
    },
    keepalive: true,
    method: 'POST'
  }).catch(() => {});
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

export async function cancelRegistration(registrationId, { cancelNote = '' } = {}) {
  const idToken = await auth?.currentUser?.getIdToken();

  if (!idToken) {
    throw new Error('You must be signed in to cancel registrations.');
  }

  const response = await fetch('/api/admin-update-registration-payment', {
    body: JSON.stringify({
      action: 'cancelRegistration',
      cancelNote,
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
    throw new Error(result.error || 'Registration could not be cancelled.');
  }

  return result;
}

// No auth token - the claim link's own token, emailed only to the
// waitlisted member, is what authorizes this. Matches the magic-link design
// already used for login recovery, so no sign-in is required to claim.
export async function claimWaitlistOffer({ confirmed = false, registrationId, squarePaymentToken = '', token }) {
  const response = await fetch('/api/create-registration', {
    body: JSON.stringify({
      action: 'claimWaitlistOffer',
      confirmed,
      registrationId,
      squarePaymentToken,
      token
    }),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'This offer could not be claimed.');
  }

  return result;
}

export async function manuallyPromoteWaitlisted(registrationId) {
  const idToken = await auth?.currentUser?.getIdToken();

  if (!idToken) {
    throw new Error('You must be signed in to manage the waitlist.');
  }

  const response = await fetch('/api/create-registration', {
    body: JSON.stringify({
      action: 'manuallyPromoteWaitlisted',
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
    throw new Error(result.error || 'Registration could not be promoted.');
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
