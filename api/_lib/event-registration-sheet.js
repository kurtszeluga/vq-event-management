import { FieldValue } from 'firebase-admin/firestore';
import {
  REGISTRATION_SHEET_COLUMN_COUNT,
  REGISTRATION_SHEET_HEADERS,
  buildRegistrationSheetName,
  buildRegistrationSheetUpdate,
  eventTakesRegistrations
} from '../../shared/eventRegistrationSheet.js';
import {
  GOOGLE_SHEETS_SCOPE,
  buildA1Range,
  clearValues,
  createSpreadsheetInFolder,
  formatNewSheet,
  getFirstSheetProperties,
  getSpreadsheetFile,
  readValues,
  renameSpreadsheet,
  toColumnLetter,
  writeValues
} from './google-sheets.js';
import { getGoogleAccessToken } from './google-access-token.js';

// Mirrors each registration-enabled event's registrations into a Google Sheet
// in the guild's Shared Drive, and creates that sheet the first time it is
// needed.
//
// The whole grid is rewritten from the registrations on every sync rather than
// a row being appended. Six places change a registration (four API endpoints,
// the Square webhook, and the waitlist cron), and an append that one of them
// forgot would leave a cancelled member sitting in the sheet as attending with
// nothing to notice it. Rewriting is self-healing: the next change to the event
// corrects whatever the last one got wrong, and a sheet that failed to update
// catches up on its own rather than needing a backfill. This is the same
// reasoning as api/_lib/event-registrant-names.js, which is worth reading
// alongside this.
//
// The one thing a rewrite must not destroy is a row a coordinator typed in
// themselves, for someone who registered at the door rather than online. Those
// are recognised by having no Registration ID and are read back out of the
// sheet and re-appended on every sync - see extractManualRows. Anything the
// coordinator puts in a column to the RIGHT of the grid is never touched,
// because the write and clear ranges stop at the last known column.
//
// Like that module, this one deliberately swallows its own failures. A member
// must never fail to register, and an admin must never fail to cancel someone,
// because Google was unreachable or a folder id was mistyped. Failures are
// recorded on the link document (`lastError`) so the admin UI can say so, and
// the next change to the event retries.
//
// Called AFTER the batch that changed the registration has committed, since it
// reads the state it is mirroring.

const SHEET_TAB_TITLE = 'Registrations';
const SETTINGS_DOCUMENT_ID = 'registrationSheets';
const LAST_GRID_COLUMN = toColumnLetter(REGISTRATION_SHEET_COLUMN_COUNT - 1);
const FIRST_EXTRA_COLUMN = toColumnLetter(REGISTRATION_SHEET_COLUMN_COUNT);

// The rightmost column this rewrite touches: the app's own columns, plus
// however many the coordinator has added beside them.
function lastExtraColumn(extraColumnCount) {
  return toColumnLetter(REGISTRATION_SHEET_COLUMN_COUNT + extraColumnCount - 1);
}

export const DEFAULT_REGISTRATION_SHEET_SETTINGS = {
  driveFolderId: '',
  enableRegistrationSheets: false
};

// Fail closed, the opposite of membership-settings.js. This feature did not
// exist before, so a missing document, a missing field or a malformed value all
// mean "off" - nothing starts writing to Drive until somebody switches it on
// and says which folder to write into.
export function resolveRegistrationSheetSettings(settingsData) {
  const enabled = settingsData?.enableRegistrationSheets;
  const folderId = settingsData?.driveFolderId;

  return {
    driveFolderId: typeof folderId === 'string' ? folderId.trim() : '',
    enableRegistrationSheets: enabled === true
  };
}

export async function getRegistrationSheetSettings(db) {
  const snapshot = await db.collection('appSettings').doc(SETTINGS_DOCUMENT_ID).get();

  return resolveRegistrationSheetSettings(snapshot.exists ? snapshot.data() : null);
}

// A dedicated service account is preferred so the key that can reach the
// guild's Drive is not the same key that can mint Firebase tokens, but falling
// back to the Firebase one means the feature can be switched on by sharing the
// Drive folder with an account that already exists - no second key to create,
// store and rotate.
function getServiceAccountJson() {
  return process.env.GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON
    || process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    || '';
}

// Whether the feature is switched on AND has everything it needs to run. Split
// out so admin-manage-event.js can tell an admin why nothing happened instead
// of leaving them looking at an event with no sheet link.
export async function getRegistrationSheetReadiness(db) {
  const settings = await getRegistrationSheetSettings(db);

  if (!settings.enableRegistrationSheets) {
    return { ...settings, ready: false, reason: 'Registration sheets are switched off in Configuration.' };
  }

  if (!settings.driveFolderId) {
    return { ...settings, ready: false, reason: 'No Shared Drive folder ID is set in Configuration.' };
  }

  if (!getServiceAccountJson()) {
    return { ...settings, ready: false, reason: 'No Google service account credentials are configured.' };
  }

  return { ...settings, ready: true, reason: '' };
}

export function registrationSheetRef(db, eventId) {
  return db.collection('eventRegistrationSheets').doc(eventId);
}

// Never throws. Returns a small result so a caller that wants to report back to
// an admin (the manual resync in admin-manage-event.js) can, while the
// registration paths that call it for its side effect can ignore it entirely.
export async function syncEventRegistrationSheet(db, eventId) {
  if (!eventId) {
    return { ok: false, reason: 'No event was given.', skipped: true };
  }

  try {
    const readiness = await getRegistrationSheetReadiness(db);

    if (!readiness.ready) {
      return { ok: false, reason: readiness.reason, skipped: true };
    }

    const eventSnap = await db.collection('events').doc(eventId).get();

    if (!eventSnap.exists) {
      return { ok: false, reason: 'The event was not found.', skipped: true };
    }

    const event = { eventId, ...eventSnap.data() };

    // An event that does not take registrations never gets a sheet. If
    // registration was switched off after one was created, the sheet is left
    // exactly as it is - it holds who had signed up, which is not ours to
    // throw away.
    if (!eventTakesRegistrations(event)) {
      return { ok: false, reason: 'This event does not take registrations.', skipped: true };
    }

    const accessToken = await getGoogleAccessToken(getServiceAccountJson(), GOOGLE_SHEETS_SCOPE);
    const sheet = await ensureSpreadsheet(db, {
      accessToken,
      event,
      eventId,
      folderId: readiness.driveFolderId
    });
    const registrationsSnapshot = await db
      .collection('registrations')
      .where('eventId', '==', eventId)
      .get();
    const { manualRowCount, registrationRowCount } = await writeRegistrationGrid({
      accessToken,
      registrations: registrationsSnapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
      sheet
    });

    await registrationSheetRef(db, eventId).set({
      eventId,
      lastError: '',
      lastSyncedDate: FieldValue.serverTimestamp(),
      manualRowCount,
      rowCount: registrationRowCount,
      sheetId: sheet.sheetId,
      sheetTitle: sheet.sheetTitle,
      spreadsheetId: sheet.spreadsheetId,
      spreadsheetUrl: sheet.spreadsheetUrl,
      updatedDate: FieldValue.serverTimestamp()
    });

    return {
      manualRowCount,
      ok: true,
      rowCount: registrationRowCount,
      spreadsheetUrl: sheet.spreadsheetUrl
    };
  } catch (error) {
    console.error('Could not sync the registration sheet', eventId, error);
    await recordSyncFailure(db, eventId, error);

    return { ok: false, reason: error.message || 'The registration sheet could not be updated.' };
  }
}

// Injectable so the ordering below can be tested without reaching Google. The
// guarantee being protected is narrow and absolute: nothing is written or
// cleared unless the read that found the coordinator's work succeeded.
const DEFAULT_SHEETS_CLIENT = { clearValues, readValues, writeValues };

// Rewrites the sheet: the app's columns from the registrations, and the
// coordinator's own columns put back where they belong.
//
// The read comes first and is deliberately NOT caught here. It is the only
// record of what the coordinator typed, so without it the writes below would
// overwrite notes and the clear would delete walk-ins, with no undo. The
// failure propagates instead and the caller abandons the whole sync, changing
// nothing. A sheet left briefly stale is recoverable; their work is not.
//
// Read with FORMULA rather than the default so a formula a coordinator wrote in
// one of their columns comes back as its text and can be written back as a
// formula. Reading the computed value instead would silently flatten it to a
// number on the first sync after they wrote it.
export async function writeRegistrationGrid({
  accessToken,
  registrations,
  sheet,
  sheetsClient = DEFAULT_SHEETS_CLIENT
}) {
  // From row 1, not row 2: the header's own extra cells are the coordinator's
  // column headings and have to survive as well. partitionExistingGrid knows
  // the first row is the header and does not mistake it for a typed-in row.
  const existingValues = await sheetsClient.readValues({
    accessToken,
    range: buildA1Range(sheet.sheetTitle, 'A1', toColumnLetter(sheet.columnCount - 1)),
    spreadsheetId: sheet.spreadsheetId,
    valueRenderOption: 'FORMULA'
  });
  const update = buildRegistrationSheetUpdate({ existingValues, registrations });

  await sheetsClient.writeValues({
    accessToken,
    range: buildA1Range(sheet.sheetTitle, 'A1', `${LAST_GRID_COLUMN}${update.rowCount}`),
    spreadsheetId: sheet.spreadsheetId,
    values: update.gridValues
  });

  // Skipped entirely when the coordinator has added no columns of their own,
  // so cells nobody is using are never touched at all.
  if (update.extraColumnCount) {
    await sheetsClient.writeValues({
      accessToken,
      range: buildA1Range(
        sheet.sheetTitle,
        `${FIRST_EXTRA_COLUMN}1`,
        `${lastExtraColumn(update.extraColumnCount)}${update.rowCount}`
      ),
      spreadsheetId: sheet.spreadsheetId,
      // As typed, not RAW: this is the half where a formula should stay a
      // formula. The app's own columns above are written RAW in the same
      // rewrite, which is why these are two calls and not one.
      valueInputOption: 'USER_ENTERED',
      values: update.extraValues
    });
  }

  // Rewriting the grid leaves whatever the previous, longer version wrote
  // below it. An unbounded range ('A12:L') clears to the bottom of the sheet,
  // so a list that shrank does not keep a ghost of the rows it lost. Done
  // after the writes, not before, so there is no moment where an admin opening
  // the sheet finds it empty - and only ever below everything just written,
  // manual rows included.
  //
  // Only as wide as this rewrite actually wrote. Clearing the sheet's full
  // width would reach columns the sync does not manage and delete whatever a
  // coordinator keeps below the table.
  await sheetsClient.clearValues({
    accessToken,
    range: buildA1Range(
      sheet.sheetTitle,
      `A${update.rowCount + 1}`,
      lastExtraColumn(update.extraColumnCount)
    ),
    spreadsheetId: sheet.spreadsheetId
  });

  return update;
}

// Returns the spreadsheet to write into, creating it if this event has never
// had one - which is what makes "set up an event with registration enabled" and
// "a sheet exists for it" the same act, whichever caller gets there first.
async function ensureSpreadsheet(db, { accessToken, event, eventId, folderId }) {
  const linkSnap = await registrationSheetRef(db, eventId).get();
  const link = linkSnap.exists ? linkSnap.data() : null;
  const wantedName = buildRegistrationSheetName(event);

  if (link?.spreadsheetId) {
    const existing = await findExistingSpreadsheet(accessToken, link);

    if (existing) {
      // The event was renamed or its date moved, so the file name no longer
      // matches. Renaming keeps a Drive folder of these readable; it changes
      // nothing about the sheet's id, so every existing link still works.
      if (existing.name !== wantedName) {
        await renameSpreadsheet({ accessToken, spreadsheetId: link.spreadsheetId, title: wantedName });
      }

      // Asked for every time rather than read back from the link document.
      // The tab's title is part of the A1 range every write uses, and an admin
      // is free to rename the tab inside the sheet - at which point a
      // remembered title makes every subsequent write fail with "Unable to
      // parse range" and the sheet silently stops updating. One extra call on
      // a sync that already makes several is worth not having that failure
      // mode exist.
      const properties = await getFirstSheetProperties({
        accessToken,
        spreadsheetId: link.spreadsheetId
      });

      return {
        columnCount: properties.columnCount,
        sheetId: properties.sheetId,
        sheetTitle: properties.sheetTitle,
        spreadsheetId: link.spreadsheetId,
        spreadsheetUrl: existing.webViewLink || link.spreadsheetUrl || ''
      };
    }

    // The file is gone or in the bin - somebody deleted it. Fall through and
    // create a replacement rather than failing every sync from here on. The
    // rows are rebuilt from Firestore anyway, so nothing is lost but the
    // coordinator's own added columns, which went into the bin with the file.
    console.warn('The linked registration sheet is missing; creating a replacement', eventId);
  }

  const created = await createSpreadsheetInFolder({
    accessToken,
    folderId,
    title: wantedName
  });
  const properties = await getFirstSheetProperties({
    accessToken,
    spreadsheetId: created.spreadsheetId
  });

  // Cosmetics plus the tab rename, in one batch. A failure here must not cost
  // us the sheet we just created - the rows matter more than a bold header, and
  // the next sync will not retry it. But the rename is in this batch, so on
  // failure the tab still has whatever Google called it ('Sheet1', or its
  // translation), and THAT is the title the write range has to use. Reporting
  // the wrong one here is how a sheet gets created and then never written to.
  let sheetTitle = SHEET_TAB_TITLE;

  try {
    await formatNewSheet({
      accessToken,
      columnCount: REGISTRATION_SHEET_HEADERS.length,
      sheetId: properties.sheetId,
      sheetTitle: SHEET_TAB_TITLE,
      spreadsheetId: created.spreadsheetId
    });
  } catch (error) {
    console.error('Could not format the new registration sheet', eventId, error);
    sheetTitle = properties.sheetTitle;
  }

  return {
    columnCount: properties.columnCount,
    sheetId: properties.sheetId,
    sheetTitle,
    spreadsheetId: created.spreadsheetId,
    spreadsheetUrl: created.spreadsheetUrl
  };
}

// A 404 means the file is gone; a 403 means the service account lost access to
// it, which is a real error worth surfacing rather than a reason to litter the
// folder with a second copy.
async function findExistingSpreadsheet(accessToken, link) {
  try {
    const file = await getSpreadsheetFile({ accessToken, spreadsheetId: link.spreadsheetId });

    return file.trashed ? null : file;
  } catch (error) {
    if (error.statusCode === 404) {
      return null;
    }

    throw error;
  }
}

// Best effort by design: this runs on the failure path, so it must not be able
// to throw a second error over the top of the first one.
async function recordSyncFailure(db, eventId, error) {
  try {
    await registrationSheetRef(db, eventId).set({
      eventId,
      lastError: String(error?.message || 'The registration sheet could not be updated.').slice(0, 500),
      lastErrorDate: FieldValue.serverTimestamp(),
      updatedDate: FieldValue.serverTimestamp()
    }, { merge: true });
  } catch (writeError) {
    console.error('Could not record the registration sheet failure', eventId, writeError);
  }
}
