// The Google Sheet projection of an event's registrations: which events get a
// sheet, what the columns are, and how a registration becomes a row. Shared by
// the browser and the Vercel functions so the two cannot disagree about it -
// keep this module free of Node-only dependencies.
//
// Only the projection lives here. Talking to Google is api/_lib/google-sheets.js
// (it needs node:crypto to sign the service-account assertion, so src/ cannot
// import it) and the orchestration is api/_lib/event-registration-sheet.js.

import {
  GUILD_TIME_ZONE,
  NON_REGISTRABLE_EVENT_TYPES,
  REGISTRATION_WINDOW_MODES
} from './registrationWindow.js';

// The coordinator's working list, so it carries more than the member-visible
// name list does: this sheet lives in the guild's own Drive, shared with the
// people already trusted with the registration table.
//
// Registration ID is last and not first. It is the column that lets a
// coordinator match a row back to the app when a name is ambiguous, but nobody
// reads it first, so it sits out of the way at the end.
export const REGISTRATION_SHEET_HEADERS = [
  'Name',
  'Email',
  'Phone',
  'Registered',
  'Status',
  'Payment Status',
  'Payment Method',
  'Amount Due',
  'Amount Paid',
  'Notes',
  'Registration ID'
];

// Which column tells an app-written row from a hand-typed one. A row the sync
// wrote always carries the registration's id here; a coordinator adding a
// walk-in at the door has no id to type, so a blank in this column is the
// signal that the row is theirs and must survive the rewrite.
export const REGISTRATION_ID_COLUMN_INDEX = REGISTRATION_SHEET_HEADERS.indexOf('Registration ID');

function hasContent(cell) {
  return String(cell ?? '').trim() !== '';
}

// Sheets truncates trailing empty cells, so a row typed into the first two
// columns comes back with a length of 2. Padding first means the Registration
// ID cell can be read by index without every caller checking the length.
function padRow(row, columnCount) {
  const padded = Array.isArray(row) ? row.slice(0, columnCount) : [];

  while (padded.length < columnCount) {
    padded.push('');
  }

  return padded;
}

// How wide the app's own part of the grid is. Everything from here rightwards
// belongs to the coordinator.
export const REGISTRATION_SHEET_COLUMN_COUNT = REGISTRATION_SHEET_HEADERS.length;

// Trailing blanks trimmed, so a coordinator's one-column note does not make
// every row 15 cells wide just because Sheets padded the row it came in on.
function extraPartOf(row) {
  const extras = Array.isArray(row) ? row.slice(REGISTRATION_SHEET_COLUMN_COUNT) : [];

  while (extras.length && !hasContent(extras[extras.length - 1])) {
    extras.pop();
  }

  return extras;
}

// Reads the sheet as it stands and sorts it into the three things a rewrite has
// to put back.
//
// `existingValues` is the whole grid INCLUDING the header row at index 0 - the
// header's own extra cells are a coordinator's column headings ("Brought
// food?", "Called?") and have to survive too.
//
//   extrasById  - the coordinator's columns for a row the app wrote, keyed by
//                 the registration id in that row. Keyed rather than kept by
//                 position because rows reorder on every sync: newest-first
//                 means a new registration pushes everything down one, and a
//                 note held by position would end up describing a stranger.
//   manualRows  - rows the coordinator typed in full, for someone who
//                 registered at the door. Recognised by a blank Registration
//                 ID; these travel as a unit, grid cells and extras together.
//   headerExtras - the header row's own extra cells.
//
// A row with nothing anywhere is a spacer and is dropped; carrying it would
// grow a tail of blank rows that never stops. A row with nothing in the app's
// columns but something in a coordinator's column is kept as a manual row, so
// a stray note is not thrown away just because its row has no name on it.
export function partitionExistingGrid(existingValues = []) {
  const rows = Array.isArray(existingValues) ? existingValues : [];
  const extrasById = new Map();
  const manualRows = [];

  rows.slice(1).forEach((row) => {
    const grid = padRow(row, REGISTRATION_SHEET_COLUMN_COUNT);
    const extras = extraPartOf(row);
    const registrationId = String(grid[REGISTRATION_ID_COLUMN_INDEX] ?? '').trim();

    if (registrationId) {
      if (extras.length) {
        extrasById.set(registrationId, extras);
      }

      return;
    }

    if (grid.some(hasContent) || extras.length) {
      manualRows.push({ extras, grid });
    }
  });

  return { extrasById, headerExtras: extraPartOf(rows[0]), manualRows };
}

// Kept as its own export because the rule it encodes - "a blank Registration
// ID means the row is the coordinator's" - is the one a coordinator is told
// about, and is worth being able to read and test on its own.
export function extractManualRows(dataRows = []) {
  return partitionExistingGrid([REGISTRATION_SHEET_HEADERS, ...dataRows])
    .manualRows
    .map((row) => row.grid);
}

// Everything a rewrite needs, worked out from the registrations plus the sheet
// as it currently stands. Pure, so the alignment can be tested without Google.
//
// Returns the app's columns and the coordinator's columns as two separate
// rectangles covering the same rows. They are written separately because they
// need different treatment: the app's columns go in as RAW so a registrant
// called "=Bob" is stored and not executed, while the coordinator's columns go
// in as typed so a formula they wrote stays a formula.
export function buildRegistrationSheetUpdate({
  existingValues = [],
  registrations = [],
  timeZone = GUILD_TIME_ZONE
} = {}) {
  const { extrasById, headerExtras, manualRows } = partitionExistingGrid(existingValues);
  // The id is read back off the row the projection just built rather than
  // threaded alongside it, so there is only one place that decides which cell
  // holds it.
  const syncedRows = buildRegistrationSheetRows(registrations, { timeZone }).map((grid) => ({
    extras: extrasById.get(String(grid[REGISTRATION_ID_COLUMN_INDEX] ?? '').trim()) || [],
    grid
  }));
  const allRows = [
    { extras: headerExtras, grid: REGISTRATION_SHEET_HEADERS },
    ...syncedRows,
    ...manualRows
  ];
  const extraColumnCount = allRows.reduce((widest, row) => Math.max(widest, row.extras.length), 0);

  return {
    extraColumnCount,
    // Left empty rather than a rectangle of blanks when the coordinator has
    // added no columns of their own, so the sync can skip that write entirely
    // and never touch cells nobody is using.
    extraValues: extraColumnCount
      ? allRows.map((row) => padRow(row.extras, extraColumnCount))
      : [],
    gridValues: allRows.map((row) => row.grid),
    manualRowCount: manualRows.length,
    registrationRowCount: syncedRows.length,
    rowCount: allRows.length
  };
}

// Every status, cancellations included. The CSV export and the printed list are
// snapshots an admin takes deliberately; this sheet is the standing record, and
// a row that silently disappears when someone cancels is how a coordinator ends
// up phoning a member who already withdrew. A cancelled registrant stays
// visible with 'Cancelled' in the Status column instead.
export function isSheetVisibleRegistration(registration) {
  return Boolean(registration) && Boolean(registration.registrationId || registration.id);
}

// Which events get a sheet at all. Mirrors getRegistrationWindowState's own
// gating minus the dates: a registration-enabled event earns a sheet the moment
// it is set up, well before its window opens, because that is when the
// coordinator wants the link. An event whose window has since closed keeps its
// sheet and keeps syncing.
export function eventTakesRegistrations(event) {
  if (!event) {
    return false;
  }

  if (NON_REGISTRABLE_EVENT_TYPES.includes(event.eventType)) {
    return false;
  }

  return REGISTRATION_WINDOW_MODES.includes(event.registrationMode);
}

// Newlines and runs of spaces are collapsed, because a title typed across two
// lines in the admin form makes the file awkward to find and awkward to link
// to. A slash is deliberately left alone: Drive is not a filesystem and treats
// it as an ordinary character, and real event titles contain them ("Pumpkin
// Time/Turned Edge Machine Applique"), so stripping it would make the sheet
// harder to match to its event rather than easier. It only matters if the file
// is downloaded, where the OS substitutes a character of its own.
//
// The date is appended because a guild runs "Monthly Meeting" twelve times a
// year and a Drive folder full of identically named sheets is useless.
export function buildRegistrationSheetName(event) {
  const title = collapseWhitespace(event?.title || event?.eventType || 'Event').slice(0, 90);
  const date = /^\d{4}-\d{2}-\d{2}/.test(String(event?.date || ''))
    ? String(event.date).slice(0, 10)
    : '';

  return `Registrations - ${title}${date ? ` (${date})` : ''}`;
}

// Newest registration first, so an event that is filling up shows today's
// sign-ups at the top of the sheet without anyone scrolling. Rows with no
// usable date sort last rather than first - an in-flight timestamp is not
// news, it is a record that has not settled yet.
//
// Reverse order means a new registration inserts at row 2 and pushes every
// existing row down one, so nothing in this sheet may depend on a row staying
// where it was. That is exactly why a coordinator's own columns are carried by
// Registration ID and not by position - see partitionExistingGrid. Reordering
// here is therefore safe to change; moving those notes back onto positions
// would not be.
export function buildRegistrationSheetRows(registrations = [], options = {}) {
  const { timeZone = GUILD_TIME_ZONE } = options;

  return registrations
    .filter(isSheetVisibleRegistration)
    .slice()
    .sort(compareByRegistrationDate)
    .map((registration) => buildRegistrationSheetRow(registration, { timeZone }));
}

export function buildRegistrationSheetRow(registration = {}, options = {}) {
  const { timeZone = GUILD_TIME_ZONE } = options;

  return [
    registration.name || '',
    registration.email || '',
    registration.phone || '',
    formatSheetDateTime(registration.registrationDate, timeZone),
    registration.status || 'Registered',
    registration.paymentStatus || '',
    registration.paymentMethod || '',
    toSheetNumber(registration.amountDue),
    toSheetNumber(registration.amountPaid),
    collapseWhitespace(registration.paymentNote || ''),
    registration.registrationId || registration.id || ''
  ];
}

// Numbers go into the sheet as numbers so the Amount columns sum, and a blank
// stays blank rather than becoming 0 - an empty cell reads as "nothing
// recorded", a zero reads as "paid nothing", and for an unpaid registration
// those are different statements.
//
// Note there is no formula-neutralising apostrophe anywhere in this module, as
// there is in registrationCsv.js. A CSV is parsed by whatever opens it, so a
// name beginning with '=' becomes a formula; the Sheets API is told
// valueInputOption RAW by api/_lib/google-sheets.js, which stores the string
// as typed. Change that option and this comment becomes wrong.
function toSheetNumber(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount) || amount === 0) {
    return '';
  }

  return amount;
}

// Firestore hands back a Timestamp server-side, a Timestamp with a different
// prototype in the browser, and an ISO string once a record has been through a
// JSON round trip. All three arrive here.
export function toRegistrationDateMillis(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }

  if (typeof value.seconds === 'number') {
    return value.seconds * 1000;
  }

  if (value instanceof Date) {
    return value.getTime();
  }

  const parsed = Date.parse(String(value));

  return Number.isNaN(parsed) ? null : parsed;
}

// Written as a plain string in guild wall-clock time rather than as a sheet
// date value. A coordinator reads this column; they do not pivot on it, and a
// real date value would arrive in whatever timezone the sheet's own locale
// says, which is not necessarily the guild's.
function formatSheetDateTime(value, timeZone) {
  const millis = toRegistrationDateMillis(value);

  if (millis === null) {
    return '';
  }

  return new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: true,
    minute: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric'
  }).format(new Date(millis)).replace(',', '');
}

function compareByRegistrationDate(first, second) {
  const firstMillis = toRegistrationDateMillis(first?.registrationDate);
  const secondMillis = toRegistrationDateMillis(second?.registrationDate);

  if (firstMillis === secondMillis) {
    return String(first?.registrationId || '').localeCompare(String(second?.registrationId || ''));
  }

  // Undated rows stay LAST in both orderings, so this pair of checks is not
  // reversed along with the subtraction below. Negating the whole comparator
  // instead would float a record whose timestamp has not settled to the very
  // top of the sheet, which is the opposite of useful.
  if (firstMillis === null) {
    return 1;
  }

  if (secondMillis === null) {
    return -1;
  }

  // Reversed: the most recent registration comes first.
  return secondMillis - firstMillis;
}

function collapseWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}
