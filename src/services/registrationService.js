import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const registrationsCollection = () => collection(db, 'registrations');
const auditLogsCollection = () => collection(db, 'auditLogs');

export function subscribeToRegistrations(onNext, onError) {
  const registrationsQuery = query(registrationsCollection(), orderBy('registrationDate', 'desc'));
  return onSnapshot(registrationsQuery, onNext, onError);
}

export async function lookupRegistrationEmail(email, eventId = '') {
  const response = await fetch('/api/registration-lookup', {
    body: JSON.stringify({ email, eventId }),
    headers: {
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
  const response = await fetch('/api/create-registration', {
    body: JSON.stringify(registrationData),
    headers: {
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

export async function verifyRegistrationPhone(email, phone) {
  const response = await fetch('/api/verify-registration-phone', {
    body: JSON.stringify({ email, phone }),
    headers: {
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Phone verification failed.');
  }

  return result;
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
