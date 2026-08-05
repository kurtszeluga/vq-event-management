import { FieldValue } from 'firebase-admin/firestore';
import { buildRegistrantNames } from '../../shared/eventRegistrantNames.js';

// Rebuilds eventRegistrantNames/{eventId} from the registrations themselves.
//
// A full rebuild rather than an incremental edit of the stored array: four
// separate files change registration status, and an incremental update that one
// of them forgot would leave a cancelled member listed as attending with nothing
// to notice it. Rebuilding is self-healing - the next change to that event
// corrects whatever the last one got wrong.
//
// Called AFTER the batch that changed the registration has committed, since it
// reads the state it is summarising.
//
// Deliberately swallows its own failures. This is a courtesy list; a member
// must never fail to register, or fail to be cancelled, because a derived
// summary could not be written. The next change to the event rebuilds it.
export async function syncEventRegistrantNames(db, eventId) {
  if (!eventId) {
    return;
  }

  try {
    const snapshot = await db
      .collection('registrations')
      .where('eventId', '==', eventId)
      .get();

    await db.collection('eventRegistrantNames').doc(eventId).set({
      eventId,
      names: buildRegistrantNames(snapshot.docs.map((doc) => doc.data())),
      updatedDate: FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.error('Could not rebuild the registrant name list', eventId, error);
  }
}
