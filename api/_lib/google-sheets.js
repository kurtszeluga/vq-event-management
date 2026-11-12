// Thin REST client for the two Google Workspace APIs the registration sheet
// sync needs. Hand-rolled `fetch` rather than `googleapis`, for the same reason
// api/_lib/google-access-token.js signs its own JWT: this project already talks
// to Google over REST, and the official client would add ~15MB to a serverless
// bundle to save a hundred lines.
//
// Every Drive call passes supportsAllDrives=true. Without it the API pretends
// Shared Drives do not exist and a create into a Shared Drive folder fails with
// a 404 on a folder that is plainly there.

const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SPREADSHEET_MIME_TYPE = 'application/vnd.google-apps.spreadsheet';
// What Google gives a new spreadsheet, used only as a fallback if the API ever
// answers without a column count.
const DEFAULT_SHEET_COLUMN_COUNT = 26;

// Space-separated, which is what the JWT's `scope` claim expects for more than
// one. The full `drive` scope rather than `drive.file` because the sheet is
// created inside a folder the app did not create, which is outside what
// per-file access covers. The blast radius is still just this service account,
// which can only see what has been shared with it - keep it out of anything but
// the registration-sheet folder.
export const GOOGLE_SHEETS_SCOPE = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
].join(' ');

// 0 -> 'A', 25 -> 'Z', 26 -> 'AA'. Only ever called with small numbers here,
// but the grid is wide enough that hardcoding 'I' would quietly break the day a
// tenth column is added.
export function toColumnLetter(index) {
  let remaining = Number(index);
  let letters = '';

  do {
    letters = String.fromCharCode(65 + (remaining % 26)) + letters;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);

  return letters;
}

// An A1 range naming its tab. The tab title is wrapped in single quotes and any
// quote inside it doubled, which is how the Sheets API escapes a title
// containing a space or an apostrophe ("Bob's list" -> 'Bob''s list').
export function buildA1Range(sheetTitle, firstCell, lastCell) {
  const cells = lastCell ? `${firstCell}:${lastCell}` : firstCell;
  const title = String(sheetTitle || '').trim();

  if (!title) {
    return cells;
  }

  return `'${title.replaceAll("'", "''")}'!${cells}`;
}

async function googleRequest(url, { accessToken, body, method = 'GET' }) {
  const response = await fetch(url, {
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
    },
    method
  });

  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    // Google nests the useful part; the HTTP status alone says nothing about
    // whether the folder id is wrong or the service account was never given
    // access, which are the two things that actually go wrong here.
    const error = new Error(
      data.error?.message || data.error_description || `Google API request failed (${response.status}).`
    );

    error.statusCode = response.status;
    error.googleReason = data.error?.errors?.[0]?.reason || '';
    throw error;
  }

  return data;
}

// Creates the spreadsheet through the DRIVE API rather than the Sheets API.
// Sheets' own spreadsheets.create cannot be told where to put the file, so the
// sheet lands in the service account's own My Drive, where no human can reach
// it and nobody can be given access. Drive's files.create takes `parents`, so
// the file is born inside the Shared Drive folder and owned by the Shared
// Drive - which is the whole point of putting it there.
export async function createSpreadsheetInFolder({ accessToken, folderId, title }) {
  const query = new URLSearchParams({
    fields: 'id,name,webViewLink',
    supportsAllDrives: 'true'
  });
  const file = await googleRequest(`${DRIVE_FILES_URL}?${query}`, {
    accessToken,
    body: {
      mimeType: SPREADSHEET_MIME_TYPE,
      name: title,
      parents: [folderId]
    },
    method: 'POST'
  });

  return {
    spreadsheetId: file.id,
    // webViewLink is what Drive hands back and what the admin UI links to.
    // Composed by hand if Drive omits it so the UI never shows a dead control.
    spreadsheetUrl: file.webViewLink || `https://docs.google.com/spreadsheets/d/${file.id}/edit`
  };
}

export async function renameSpreadsheet({ accessToken, spreadsheetId, title }) {
  const query = new URLSearchParams({ fields: 'id,name', supportsAllDrives: 'true' });

  return googleRequest(`${DRIVE_FILES_URL}/${encodeURIComponent(spreadsheetId)}?${query}`, {
    accessToken,
    body: { name: title },
    method: 'PATCH'
  });
}

// Used to tell "the sheet is fine" apart from "somebody deleted the sheet".
// A trashed file still answers a GET, so `trashed` is read explicitly - without
// it the sync would keep writing rows into a file in the bin.
export async function getSpreadsheetFile({ accessToken, spreadsheetId }) {
  const query = new URLSearchParams({
    // modifiedTime and lastModifyingUser are how a hand edit is detected: our
    // own writes move modifiedTime too, but a later one means somebody has
    // been in the sheet since. See getRegistrationSheetState.
    fields: 'id,name,trashed,webViewLink,modifiedTime,lastModifyingUser(displayName)',
    supportsAllDrives: 'true'
  });

  return googleRequest(`${DRIVE_FILES_URL}/${encodeURIComponent(spreadsheetId)}?${query}`, {
    accessToken
  });
}

// Every tab in the spreadsheet, in the order Google reports them, each with its
// title, numeric id and width.
//
// columnCount is how far right the sync has to read to find a coordinator's own
// columns. A new sheet is 26 columns wide; someone who needed more will have
// added them, and reading only as far as Z would silently drop whatever they
// put past it.
export async function listSheetProperties({ accessToken, spreadsheetId }) {
  const query = new URLSearchParams({
    fields: 'sheets(properties(sheetId,title,gridProperties(columnCount)))'
  });
  const data = await googleRequest(
    `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}?${query}`,
    { accessToken }
  );
  const tabs = (data.sheets || [])
    .map((sheet) => sheet.properties)
    .filter(Boolean)
    .map((properties) => ({
      columnCount: Number(properties.gridProperties?.columnCount) || DEFAULT_SHEET_COLUMN_COUNT,
      sheetId: properties.sheetId,
      sheetTitle: properties.title
    }));

  if (!tabs.length) {
    throw new Error('The spreadsheet has no sheets to write to.');
  }

  return tabs;
}

// Only safe where "first" is unambiguous: a spreadsheet this code just created,
// which has exactly one tab. Anywhere else the tab must be found by its id -
// see resolveRegistrationTab in api/_lib/event-registration-sheet.js for why.
export async function getFirstSheetProperties({ accessToken, spreadsheetId }) {
  const [first] = await listSheetProperties({ accessToken, spreadsheetId });

  return first;
}

// Adds a tab and returns its properties. Used when the tab the sync has been
// writing to has been deleted: a replacement is created rather than adopting
// whichever tab now happens to be first, because that tab is somebody's work.
//
// Google refuses a duplicate tab title, so the caller picks one that is free.
export async function addSheet({ accessToken, spreadsheetId, title }) {
  const data = await googleRequest(`${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    accessToken,
    body: {
      requests: [{ addSheet: { properties: { title } } }],
      includeSpreadsheetInResponse: false
    },
    method: 'POST'
  });
  const properties = data.replies?.[0]?.addSheet?.properties;

  if (!properties) {
    throw new Error('The spreadsheet tab could not be created.');
  }

  return {
    columnCount: Number(properties.gridProperties?.columnCount) || DEFAULT_SHEET_COLUMN_COUNT,
    sheetId: properties.sheetId,
    sheetTitle: properties.title
  };
}

// Defaults to valueInputOption RAW, which is what the app's own columns want.
// USER_ENTERED would parse every cell the way typing it would: a name beginning
// with '=' becomes a formula, a phone number loses its leading zero, and '1-2'
// becomes a date. RAW stores exactly what it is given, which also means the
// apostrophe-escaping the CSV export needs is not wanted here (see
// shared/eventRegistrationSheet.js).
//
// The caller overrides it to USER_ENTERED for one range only: the columns a
// coordinator added for themselves, where a formula they wrote should go back
// in as a formula. That is why the registration sheet is written in two calls -
// see writeRegistrationGrid in api/_lib/event-registration-sheet.js.
export async function writeValues({
  accessToken,
  range,
  spreadsheetId,
  valueInputOption = 'RAW',
  values
}) {
  const query = new URLSearchParams({ valueInputOption });

  return googleRequest(
    `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${query}`,
    { accessToken, body: { values }, method: 'PUT' }
  );
}

// Reads the grid back so the sync can see what a coordinator typed into it
// before overwriting it. UNFORMATTED_VALUE, so a number the coordinator typed
// comes back as a number rather than as whatever the sheet's locale displays,
// and a blank cell comes back blank rather than as the empty string a formula
// would produce.
//
// Sheets truncates trailing empty cells, so a row of 11 columns with only the
// first two filled comes back with length 2. Callers must pad - see
// shared/eventRegistrationSheet.js.
export async function readValues({
  accessToken,
  range,
  spreadsheetId,
  valueRenderOption = 'UNFORMATTED_VALUE'
}) {
  const query = new URLSearchParams({ valueRenderOption });
  const data = await googleRequest(
    `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}?${query}`,
    { accessToken }
  );

  // `values` is omitted entirely when the range holds nothing.
  return data.values || [];
}

export async function clearValues({ accessToken, range, spreadsheetId }) {
  return googleRequest(
    `${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}:clear`,
    { accessToken, body: {}, method: 'POST' }
  );
}

// One-time cosmetics, applied when the sheet is created and never again - an
// admin who widens a column or recolours the header should keep their change.
// Freezing the header is the one that matters: without it, scrolling a long
// attendee list leaves you guessing which column is which.
export async function formatNewSheet({
  accessToken,
  columnCount,
  sheetId,
  sheetTitle,
  spreadsheetId
}) {
  const requests = [
    {
      updateSheetProperties: {
        fields: 'title,gridProperties.frozenRowCount',
        properties: {
          gridProperties: { frozenRowCount: 1 },
          sheetId,
          title: sheetTitle
        }
      }
    },
    {
      repeatCell: {
        cell: {
          userEnteredFormat: {
            backgroundColor: { blue: 0.93, green: 0.93, red: 0.93 },
            textFormat: { bold: true }
          }
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
        range: { endRowIndex: 1, sheetId, startRowIndex: 0 }
      }
    },
    {
      autoResizeDimensions: {
        dimensions: {
          dimension: 'COLUMNS',
          endIndex: columnCount,
          sheetId,
          startIndex: 0
        }
      }
    }
  ];

  return googleRequest(`${SHEETS_URL}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
    accessToken,
    body: { requests },
    method: 'POST'
  });
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
