import {
  isSheetVisibleRegistration,
  toRegistrationDateMillis
} from '../../shared/eventRegistrationSheet.js';

// Decides what, if anything, the registration list should offer about an
// event's Google Sheet.
//
// The sheet syncs itself on every registration, cancellation and payment
// change, so a permanent "Update Sheet" button reads as an instruction -
// coordinators assumed they had to press it each time. The control now appears
// only in the states where pressing it actually does something, and the settled
// state says so in words instead.
//
// IMPORTANT LIMIT, and the reason 'current' still offers a quiet refresh:
// every comparison here is Firestore against Firestore. `rowCount` is what the
// LAST SYNC WROTE, not what the spreadsheet contains now. So this detects a
// sync that did not run - a registration arriving while Google was
// unreachable - and it cannot detect somebody editing or deleting rows in the
// sheet by hand. Reading the live sheet would mean a Google round trip on every
// view of this page, and would make the attendee list depend on Google being
// up, which is not worth it. The honest answer is to say what is known, never
// claim to describe the sheet's contents, and always leave a way to resync.
//
// Kept as a pure function so every state can be tested without rendering.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

// 'unknown'  - the settings read failed, so whether the feature is even on is
//              not known. Says so, rather than looking identical to 'disabled'.
// 'disabled' - the board has not switched the feature on. Nothing is shown at
//              all: a project with this off would otherwise put a control on
//              every event that can only ever report that it is off.
// 'failed'   - the last sync recorded an error. Checked before 'missing',
//              because a failure to CREATE leaves both set and the error is
//              the more useful of the two things to say.
// 'missing'  - on, but this event has no sheet. An event set up before the
//              feature was switched on has had nothing happen to trigger one.
// 'stale'    - the stored row count disagrees with the registrations on screen,
//              so a sync did not run when it should have.
// 'current'  - nothing to do, and the UI should say so rather than stay silent.
export function getRegistrationSheetStatus({
  enabled = false,
  now = Date.now(),
  registrations = [],
  sheet = null
} = {}) {
  // `enabled` null means the settings read failed, which is NOT the same as
  // the feature being off. Rendering nothing for both would make a page that
  // could not reach Firestore look exactly like a project that has never
  // switched this on, and there would be nothing to tell them apart by.
  // Only an explicit null. An omitted `enabled` takes the default of false
  // above, which is the right fail-closed behaviour for a caller that has not
  // looked - so `undefined` never arrives here.
  if (enabled === null) {
    return {
      actionLabel: 'Retry',
      actionable: true,
      canRefresh: true,
      message: 'The sheet settings could not be read, so this may be out of date.',
      state: 'unknown',
      tone: 'error'
    };
  }

  if (!enabled) {
    return { actionable: false, canRefresh: false, state: 'disabled' };
  }

  const expectedRowCount = registrations.filter(isSheetVisibleRegistration).length;
  const syncedRowCount = Number(sheet?.rowCount || 0);

  if (sheet?.lastError) {
    return {
      actionLabel: 'Retry',
      actionable: true,
      canRefresh: true,
      message: sheet.lastError,
      state: 'failed',
      tone: 'error'
    };
  }

  if (!sheet?.spreadsheetId) {
    return {
      actionLabel: 'Create Sheet',
      actionable: true,
      canRefresh: true,
      message: 'This event has no Google Sheet yet.',
      state: 'missing',
      tone: 'notice'
    };
  }

  if (syncedRowCount !== expectedRowCount) {
    return {
      actionLabel: 'Update Sheet',
      actionable: true,
      canRefresh: true,
      // Describes the last WRITE, not the sheet's current contents, which is
      // all this can honestly claim to know.
      message: `Last synced with ${syncedRowCount} registration${syncedRowCount === 1 ? '' : 's'}; there ${expectedRowCount === 1 ? 'is' : 'are'} now ${expectedRowCount}.`,
      state: 'stale',
      tone: 'notice'
    };
  }

  return {
    actionable: false,
    // No prominent button - there is nothing known to be wrong - but a quiet
    // refresh stays available, because a hand edit to the sheet is invisible
    // from here and this is the only way back from one.
    canRefresh: true,
    message: `Updated ${formatSyncAge(sheet.lastSyncedDate, now)}`,
    state: 'current',
    tone: 'quiet'
  };
}

// Relative for anything recent, because "updated 2 minutes ago" is what makes
// the automatic behaviour believable. Falls back to a date once relative stops
// being informative.
export function formatSyncAge(value, now = Date.now()) {
  const millis = toRegistrationDateMillis(value);

  if (millis === null) {
    return 'automatically';
  }

  const age = now - millis;

  if (age < 0 || age < MINUTE_MS) {
    return 'just now';
  }

  if (age < HOUR_MS) {
    const minutes = Math.floor(age / MINUTE_MS);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }

  if (age < DAY_MS) {
    const hours = Math.floor(age / HOUR_MS);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }

  return `on ${new Date(millis).toLocaleDateString()}`;
}
