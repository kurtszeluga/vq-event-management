import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  where
} from 'firebase/firestore';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../lib/firebase.js';

const eventsCollection = () => collection(db, 'events');

export function subscribeToAdminEvents(onNext, onError) {
  const eventsQuery = query(eventsCollection(), orderBy('date', 'asc'));
  return onSnapshot(eventsQuery, onNext, onError);
}

export function subscribeToPublishedEvents(onNext, onError) {
  const eventsQuery = query(
    eventsCollection(),
    where('status', '==', 'Published'),
    orderBy('date', 'asc')
  );
  return onSnapshot(eventsQuery, onNext, onError);
}

export async function createEvent(eventData) {
  const result = await postEventAction({
    action: 'create',
    eventData
  });

  return result.eventId;
}

export async function updateEvent(eventId, eventData) {
  await postEventAction({
    action: 'update',
    eventData,
    eventId
  });
}

export async function deleteEvent(eventId) {
  await postEventAction({
    action: 'delete',
    eventId
  });
}

export async function archiveEvent(eventId) {
  await postEventAction({
    action: 'archive',
    eventId
  });
}

export async function reactivateEvent(eventId) {
  await postEventAction({
    action: 'reactivate',
    eventId
  });
}

export async function getEvent(eventId) {
  const eventSnap = await getDoc(doc(db, 'events', eventId));

  if (!eventSnap.exists()) {
    return null;
  }

  return { id: eventSnap.id, ...eventSnap.data() };
}

async function postEventAction(body) {
  const idToken = await getAdminIdToken();

  if (!idToken) {
    throw new Error('You must be signed in to manage events.');
  }

  const response = await fetch('/api/admin-manage-event', {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });
  const result = await parseJsonResponse(response);

  if (!response.ok) {
    throw new Error(result.error || 'Event could not be saved.');
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

async function getAdminIdToken() {
  if (!auth) {
    return '';
  }

  const currentUser = auth.currentUser || (await waitForCurrentUser());

  if (!currentUser) {
    return '';
  }

  return currentUser.getIdToken();
}

function waitForCurrentUser() {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (firebaseUser) => {
        unsubscribe();
        resolve(firebaseUser);
      },
      () => {
        unsubscribe();
        resolve(null);
      }
    );
  });
}
