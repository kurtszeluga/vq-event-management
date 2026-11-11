import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase.js';

// Read-only browser half of api/_lib/event-registration-sheet.js. There is no
// write counterpart here on purpose: the sheet is written by the server, and
// firestore.rules refuses client writes to eventRegistrationSheets so a
// tampered client cannot point an event's sync at a spreadsheet of its own
// (see the rule's comment). The one thing a client may do is ask the server to
// resync, which is eventService.js's syncEventRegistrationSheet.

const EMPTY_SHEET_LINK = {
  lastError: '',
  rowCount: 0,
  spreadsheetId: '',
  spreadsheetUrl: ''
};

function readSheetLink(snapshot) {
  if (!snapshot.exists()) {
    return EMPTY_SHEET_LINK;
  }

  const data = snapshot.data();

  return {
    lastError: data.lastError || '',
    lastSyncedDate: data.lastSyncedDate || null,
    rowCount: Number(data.rowCount || 0),
    spreadsheetId: data.spreadsheetId || '',
    spreadsheetUrl: data.spreadsheetUrl || ''
  };
}

// An absent document is not an error: it means this event has never been
// synced - the feature is off, the event takes no registrations, or it was set
// up before any of this existed. All three render as "no sheet yet" rather
// than as a failure.
export async function getEventRegistrationSheet(eventId) {
  if (!eventId) {
    return EMPTY_SHEET_LINK;
  }

  return readSheetLink(await getDoc(doc(db, 'eventRegistrationSheets', eventId)));
}

export function subscribeToEventRegistrationSheet(eventId, onNext, onError) {
  return onSnapshot(
    doc(db, 'eventRegistrationSheets', eventId),
    (snapshot) => {
      onNext(readSheetLink(snapshot));
    },
    onError
  );
}
