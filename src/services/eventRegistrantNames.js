import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where
} from 'firebase/firestore';
import { db } from '../lib/firebase.js';
import { buildRegistrantNames } from '../../shared/eventRegistrantNames.js';

// Browser half of api/_lib/event-registrant-names.js - see the note there for
// why this is a full rebuild rather than an incremental edit, and why it never
// throws. Duplicated rather than shared because api/_lib pulls in node:crypto
// and cannot be imported from src/; the projection itself lives once, in
// shared/eventRegistrantNames.js.

export async function syncEventRegistrantNames(eventId) {
  if (!eventId) {
    return;
  }

  try {
    const snapshot = await getDocs(
      query(collection(db, 'registrations'), where('eventId', '==', eventId))
    );

    await setDoc(doc(db, 'eventRegistrantNames', eventId), {
      eventId,
      names: buildRegistrantNames(snapshot.docs.map((entry) => entry.data())),
      updatedDate: serverTimestamp()
    });
  } catch (error) {
    console.error('Could not rebuild the registrant name list', eventId, error);
  }
}

// Members read the derived document, never the registrations. An absent
// document means nobody is registered yet, or the board has never switched the
// setting on - both render as an empty list rather than as an error.
export function subscribeToEventRegistrantNames(eventId, onNext, onError) {
  return onSnapshot(
    doc(db, 'eventRegistrantNames', eventId),
    (snapshot) => {
      onNext(snapshot.exists() ? snapshot.data().names || [] : []);
    },
    onError
  );
}
