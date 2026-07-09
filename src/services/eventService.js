import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

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
  const docRef = await addDoc(eventsCollection(), {
    ...eventData,
    createdDate: serverTimestamp(),
    updatedDate: serverTimestamp()
  });

  await updateDoc(docRef, { eventId: docRef.id });

  return docRef.id;
}

export function updateEvent(eventId, eventData) {
  return updateDoc(doc(db, 'events', eventId), {
    ...eventData,
    updatedDate: serverTimestamp()
  });
}

export function deleteEvent(eventId) {
  return deleteDoc(doc(db, 'events', eventId));
}

export async function getEvent(eventId) {
  const eventSnap = await getDoc(doc(db, 'events', eventId));

  if (!eventSnap.exists()) {
    return null;
  }

  return { id: eventSnap.id, ...eventSnap.data() };
}
