import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
  where
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';

const eventsCollection = () => collection(db, 'events');
const auditLogsCollection = () => collection(db, 'auditLogs');

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

export async function createEvent(eventData, actorProfile) {
  const batch = writeBatch(db);
  const docRef = doc(eventsCollection());
  const eventPayload = {
    ...eventData,
    eventId: docRef.id,
    createdDate: serverTimestamp(),
    updatedDate: serverTimestamp()
  };

  batch.set(docRef, eventPayload);
  addAuditLog(batch, {
    action: 'Create',
    actorProfile,
    after: eventData,
    before: {},
    entityId: docRef.id,
    summary: `Created event "${eventData.title}"`
  });

  await batch.commit();

  return docRef.id;
}

export async function updateEvent(eventId, eventData, actorProfile) {
  const eventRef = doc(db, 'events', eventId);
  const eventSnap = await getDoc(eventRef);
  const batch = writeBatch(db);

  batch.update(eventRef, {
    ...eventData,
    updatedDate: serverTimestamp()
  });

  addAuditLog(batch, {
    action: 'Update',
    actorProfile,
    after: eventData,
    before: eventSnap.exists() ? eventSnap.data() : {},
    entityId: eventId,
    summary: `Updated event "${eventData.title}"`
  });

  return batch.commit();
}

export async function deleteEvent(eventId, actorProfile) {
  const eventRef = doc(db, 'events', eventId);
  const eventSnap = await getDoc(eventRef);
  const eventData = eventSnap.exists() ? eventSnap.data() : {};
  const batch = writeBatch(db);

  batch.delete(eventRef);
  addAuditLog(batch, {
    action: 'Delete',
    actorProfile,
    after: {},
    before: eventData,
    entityId: eventId,
    summary: `Deleted event "${eventData.title || eventId}"`
  });

  return batch.commit();
}

export async function getEvent(eventId) {
  const eventSnap = await getDoc(doc(db, 'events', eventId));

  if (!eventSnap.exists()) {
    return null;
  }

  return { id: eventSnap.id, ...eventSnap.data() };
}

function addAuditLog(batch, { action, actorProfile, after, before, entityId, summary }) {
  const auditRef = doc(auditLogsCollection());
  const actor = getAuditActor(actorProfile);

  batch.set(auditRef, {
    action,
    actorEmail: actor.email,
    actorName: actor.name,
    actorRole: actor.role,
    actorUserId: actor.userId,
    after,
    before,
    createdDate: serverTimestamp(),
    entityId,
    entityType: 'Event',
    summary
  });
}

function getAuditActor(actorProfile) {
  return {
    email: actorProfile?.email || '',
    name: actorProfile?.name || actorProfile?.email || 'Unknown Admin',
    role: actorProfile?.role || '',
    userId: actorProfile?.userId || actorProfile?.id || ''
  };
}
