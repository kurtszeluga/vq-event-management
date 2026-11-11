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
// Kept as a pure function so every state can be tested without rendering.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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
  if (!enabled) {
    return { actionable: false, state: 'disabled' };
  }

  const expectedRowCount = registrations.filter(isSheetVisibleRegistration).length;
  const syncedRowCount = Number(sheet?.rowCount || 0);

  if (sheet?.lastError) {
    return {
      actionLabel: 'Retry',
      actionable: true,
      message: sheet.lastError,
      state: 'failed',
      tone: 'error'
    };
  }

  if (!sheet?.spreadsheetId) {
    return {
      actionLabel: 'Create Sheet',
      actionable: true,
      message: 'This event has no Google Sheet yet.',
      state: 'missing',
      tone: 'notice'
    };
  }

  if (syncedRowCount !== expectedRowCount) {
    return {
      actionLabel: 'Update Sheet',
      actionable: true,
      message: `The sheet shows ${syncedRowCount} of ${expectedRowCount} registrations and may be out of date.`,
      state: 'stale',
      tone: 'notice'
    };
  }

  return {
    actionable: false,
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
