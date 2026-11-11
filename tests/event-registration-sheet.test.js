import assert from 'node:assert/strict';
import test from 'node:test';
import {
  REGISTRATION_ID_COLUMN_INDEX,
  REGISTRATION_SHEET_COLUMN_COUNT,
  REGISTRATION_SHEET_HEADERS,
  buildRegistrationSheetName,
  buildRegistrationSheetRow,
  buildRegistrationSheetRows,
  buildRegistrationSheetUpdate,
  eventTakesRegistrations,
  extractManualRows,
  isSheetVisibleRegistration,
  partitionExistingGrid,
  toRegistrationDateMillis
} from '../shared/eventRegistrationSheet.js';
import {
  buildA1Range,
  toColumnLetter
} from '../api/_lib/google-sheets.js';
import {
  nextAvailableTabTitle,
  resolveRegistrationSheetSettings,
  resolveRegistrationTab,
  writeRegistrationGrid
} from '../api/_lib/event-registration-sheet.js';

const COLUMN = REGISTRATION_SHEET_HEADERS.reduce((map, header, index) => ({
  ...map,
  [header]: index
}), {});

function registration(overrides = {}) {
  return {
    amountDue: 35,
    amountPaid: 35,
    email: 'ada@example.com',
    name: 'Ada Lovelace',
    paymentMethod: 'Card',
    paymentStatus: 'Paid',
    phone: '(555) 123-4567',
    registrationDate: new Date('2026-03-04T15:30:00Z'),
    registrationId: 'reg-1',
    status: 'Registered',
    ...overrides
  };
}

test('eventTakesRegistrations follows the mode, not the dates', () => {
  // A window that has not opened, or has already closed, still earns a sheet -
  // the coordinator wants the link at setup time and wants the final list
  // after the event.
  assert.equal(eventTakesRegistrations({ registrationMode: 'future' }), true);
  assert.equal(eventTakesRegistrations({ registrationMode: 'now' }), true);
  assert.equal(
    eventTakesRegistrations({ registrationCloseAt: '2020-01-01T00:00', registrationMode: 'now' }),
    true
  );

  assert.equal(eventTakesRegistrations({ registrationMode: 'none' }), false);
  assert.equal(eventTakesRegistrations({}), false);
  assert.equal(eventTakesRegistrations(null), false);
});

test('eventTakesRegistrations refuses the listing types however they are configured', () => {
  // Business Listing and For Sale never take registrations, so a mode left
  // behind on one of them must not conjure a sheet.
  assert.equal(
    eventTakesRegistrations({ eventType: 'Business Listing', registrationMode: 'now' }),
    false
  );
  assert.equal(
    eventTakesRegistrations({ eventType: 'For Sale', registrationMode: 'now' }),
    false
  );
  assert.equal(
    eventTakesRegistrations({ eventType: 'Workshop', registrationMode: 'now' }),
    true
  );
});

test('a row lines up with the headers', () => {
  const row = buildRegistrationSheetRow(registration());

  assert.equal(row.length, REGISTRATION_SHEET_HEADERS.length);
  assert.equal(row[COLUMN.Name], 'Ada Lovelace');
  assert.equal(row[COLUMN.Email], 'ada@example.com');
  assert.equal(row[COLUMN.Phone], '(555) 123-4567');
  assert.equal(row[COLUMN.Status], 'Registered');
  assert.equal(row[COLUMN['Payment Status']], 'Paid');
  assert.equal(row[COLUMN['Payment Method']], 'Card');
  assert.equal(row[COLUMN['Registration ID']], 'reg-1');
});

test('the amount columns carry numbers so the sheet can sum them', () => {
  const row = buildRegistrationSheetRow(registration({ amountDue: 35, amountPaid: 10 }));

  assert.equal(row[COLUMN['Amount Due']], 35);
  assert.equal(row[COLUMN['Amount Paid']], 10);
  assert.equal(typeof row[COLUMN['Amount Due']], 'number');
});

test('an unrecorded amount is blank rather than zero', () => {
  // An empty cell reads as "nothing recorded"; a 0 reads as "paid nothing",
  // and for an unpaid registration those are different statements.
  const row = buildRegistrationSheetRow(registration({ amountPaid: 0 }));

  assert.equal(row[COLUMN['Amount Paid']], '');

  const missing = buildRegistrationSheetRow(registration({ amountDue: undefined, amountPaid: null }));

  assert.equal(missing[COLUMN['Amount Due']], '');
  assert.equal(missing[COLUMN['Amount Paid']], '');
});

test('a name beginning with = is written through untouched', () => {
  // The CSV export has to prefix an apostrophe because the spreadsheet parses
  // the file it opens. The Sheets API is told valueInputOption RAW, which
  // stores the string as given, so adding the apostrophe here would put a
  // visible one in the cell. If this test fails, check that google-sheets.js
  // still sends RAW.
  const row = buildRegistrationSheetRow(registration({ name: '=SUM(A1:A9)' }));

  assert.equal(row[COLUMN.Name], '=SUM(A1:A9)');
});

test('the registered column is guild wall-clock time, not UTC', () => {
  // 15:30 UTC on 4 March is 10:30 the same morning in Loudon. Rendered in UTC
  // this still reads as the 4th, so the test uses a time that crosses the date
  // line too: 02:00 UTC on the 5th is 21:00 on the 4th at the guild.
  const sameDay = buildRegistrationSheetRow(registration());
  assert.match(sameDay[COLUMN.Registered], /03\/04\/2026/);
  assert.match(sameDay[COLUMN.Registered], /10:30/);

  const acrossMidnight = buildRegistrationSheetRow(registration({
    registrationDate: new Date('2026-03-05T02:00:00Z')
  }));
  assert.match(acrossMidnight[COLUMN.Registered], /03\/04\/2026/);
});

test('a registration with no usable date leaves the column blank', () => {
  // An in-flight serverTimestamp() sentinel has no value to read yet.
  const row = buildRegistrationSheetRow(registration({ registrationDate: null }));

  assert.equal(row[COLUMN.Registered], '');
});

test('toRegistrationDateMillis reads every shape a timestamp arrives in', () => {
  const millis = Date.UTC(2026, 2, 4, 15, 30);

  assert.equal(toRegistrationDateMillis({ toMillis: () => millis }), millis);
  assert.equal(toRegistrationDateMillis({ toDate: () => new Date(millis) }), millis);
  assert.equal(toRegistrationDateMillis({ seconds: millis / 1000 }), millis);
  assert.equal(toRegistrationDateMillis(new Date(millis)), millis);
  assert.equal(toRegistrationDateMillis('2026-03-04T15:30:00.000Z'), millis);
  assert.equal(toRegistrationDateMillis(null), null);
  assert.equal(toRegistrationDateMillis('not a date'), null);
});

test('rows run newest first, with undated records still last', () => {
  // Reverse chronological so an event that is filling up shows today's
  // sign-ups at the top. Undated records are NOT reversed along with the
  // rest - a timestamp that has not settled yet is not the day's news, so it
  // stays at the bottom in both orderings.
  const rows = buildRegistrationSheetRows([
    registration({ name: 'Middle', registrationDate: new Date('2026-03-05T12:00:00Z'), registrationId: 'b' }),
    registration({ name: 'Undated', registrationDate: null, registrationId: 'd' }),
    registration({ name: 'Oldest', registrationDate: new Date('2026-03-04T12:00:00Z'), registrationId: 'a' }),
    registration({ name: 'Newest', registrationDate: new Date('2026-03-06T12:00:00Z'), registrationId: 'c' })
  ]);

  assert.deepEqual(
    rows.map((row) => row[COLUMN.Name]),
    ['Newest', 'Middle', 'Oldest', 'Undated']
  );
});

test('two registrations sharing a timestamp keep a stable order', () => {
  // Nothing meaningful separates them, so the order must at least not change
  // between syncs - otherwise the sheet reshuffles for no reason.
  const build = () => buildRegistrationSheetRows([
    registration({ name: 'Bea', registrationId: 'reg-2' }),
    registration({ name: 'Al', registrationId: 'reg-1' })
  ]).map((row) => row[COLUMN.Name]);

  assert.deepEqual(build(), build());
});

test('buildRegistrationSheetRows does not mutate what it was given', () => {
  // It sorts, and sorting the caller's array in place would reorder the
  // snapshot the caller is still holding.
  const input = [
    registration({ name: 'Earlier', registrationDate: new Date('2026-03-04T12:00:00Z') }),
    registration({ name: 'Later', registrationDate: new Date('2026-03-06T12:00:00Z') })
  ];

  buildRegistrationSheetRows(input);

  assert.equal(input[0].name, 'Earlier');
});

test('cancelled registrations stay in the sheet', () => {
  // A row that silently disappears is how a coordinator ends up phoning
  // someone who already withdrew.
  const rows = buildRegistrationSheetRows([
    registration({ registrationId: 'a', status: 'Cancelled' }),
    registration({ registrationId: 'b', status: 'Waitlisted' }),
    registration({ registrationId: 'c', status: 'Registered' })
  ]);

  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((row) => row[COLUMN.Status]).sort(), [
    'Cancelled',
    'Registered',
    'Waitlisted'
  ]);
});

test('a record with no id is left out', () => {
  assert.equal(isSheetVisibleRegistration(registration()), true);
  assert.equal(isSheetVisibleRegistration({ id: 'from-the-doc' }), true);
  assert.equal(isSheetVisibleRegistration({ name: 'No id' }), false);
  assert.equal(isSheetVisibleRegistration(null), false);
  assert.equal(buildRegistrationSheetRows([{ name: 'No id' }]).length, 0);
});

test('the sheet name carries the date so a repeating event is tellable apart', () => {
  assert.equal(
    buildRegistrationSheetName({ date: '2026-03-04', title: 'Monthly Meeting' }),
    'Registrations - Monthly Meeting (2026-03-04)'
  );
  assert.equal(
    buildRegistrationSheetName({ eventType: 'Workshop' }),
    'Registrations - Workshop'
  );
});

test('the sheet name flattens a title that would be awkward in Drive', () => {
  assert.equal(
    buildRegistrationSheetName({ title: 'Spring\n  Retreat  ' }),
    'Registrations - Spring Retreat'
  );
});

test('registration sheet settings fail closed', () => {
  // Nothing is written to anyone Drive until the board switches this on and
  // says which folder, so every missing or malformed value means off.
  assert.deepEqual(resolveRegistrationSheetSettings(null), {
    driveFolderId: '',
    enableRegistrationSheets: false
  });
  assert.deepEqual(resolveRegistrationSheetSettings({}), {
    driveFolderId: '',
    enableRegistrationSheets: false
  });
  assert.equal(
    resolveRegistrationSheetSettings({ enableRegistrationSheets: 'true' }).enableRegistrationSheets,
    false
  );
  assert.equal(
    resolveRegistrationSheetSettings({ driveFolderId: 123 }).driveFolderId,
    ''
  );
  assert.deepEqual(
    resolveRegistrationSheetSettings({ driveFolderId: '  folder-1  ', enableRegistrationSheets: true }),
    { driveFolderId: 'folder-1', enableRegistrationSheets: true }
  );
});

test('the write range covers every column', () => {
  // The grid is written to A1:<last column><rows+1>. If a header is added and
  // this letter does not move with it, the new column is never written.
  assert.equal(toColumnLetter(REGISTRATION_SHEET_HEADERS.length - 1), 'K');
  assert.equal(toColumnLetter(0), 'A');
  assert.equal(toColumnLetter(25), 'Z');
  assert.equal(toColumnLetter(26), 'AA');
});

test('an A1 range escapes a tab title that needs it', () => {
  assert.equal(buildA1Range('Registrations', 'A1', 'K12'), "'Registrations'!A1:K12");
  assert.equal(buildA1Range("Bob's list", 'A1'), "'Bob''s list'!A1");
  assert.equal(buildA1Range('', 'A1', 'K12'), 'A1:K12');
});

// A coordinator taking names at the door types them straight into the sheet.
// Every sync rewrites the whole grid, so if these rows are not carried across
// they are destroyed by the next person to register online - silently, with no
// undo. This is the most consequential behaviour in the module.
test('a hand-typed row is recognised by its blank Registration ID', () => {
  const manual = extractManualRows([
    ['Ada Lovelace', 'ada@example.com', '', '', 'Registered', '', '', '', '', '', 'reg-1'],
    ['Walk In Wanda', 'wanda@example.com', '(555) 999-0000', '', 'Registered', '', '', '', '', 'Paid cash at door', '']
  ]);

  assert.equal(manual.length, 1);
  assert.equal(manual[0][COLUMN.Name], 'Walk In Wanda');
  assert.equal(manual[0][COLUMN.Notes], 'Paid cash at door');
});

test('a row typed into only the first cells is kept, and padded', () => {
  // Sheets truncates trailing empty cells, so a name typed on its own arrives
  // as a one-element array. Without padding, reading the Registration ID cell
  // by index is undefined and the row's width breaks the write.
  const manual = extractManualRows([['Walk In Wanda']]);

  assert.equal(manual.length, 1);
  assert.equal(manual[0].length, REGISTRATION_SHEET_HEADERS.length);
  assert.equal(manual[0][COLUMN.Name], 'Walk In Wanda');
  assert.equal(manual[0][REGISTRATION_ID_COLUMN_INDEX], '');
});

test('blank spacer rows are dropped rather than carried forward', () => {
  // Otherwise every sync would re-append them and the sheet would grow a
  // tail of empty rows that never stops.
  const manual = extractManualRows([
    [],
    ['', '', '', '', '', '', '', '', '', '', ''],
    ['   ', ''],
    ['Walk In Wanda', '', '', '', '', '', '', '', '', '', '']
  ]);

  assert.equal(manual.length, 1);
  assert.equal(manual[0][COLUMN.Name], 'Walk In Wanda');
});

test('a synced row is never duplicated as a manual one', () => {
  // Every row the sync wrote carries an id, so none of them come back.
  const synced = buildRegistrationSheetRows([
    registration({ registrationId: 'reg-1' }),
    registration({ registrationId: 'reg-2' })
  ]);

  assert.deepEqual(extractManualRows(synced), []);
});

test('the header is not mistaken for a manual row', () => {
  // The header has no Registration ID value either - it has the LABEL
  // "Registration ID" - so passing it in would read as content and duplicate
  // the header down the sheet on every sync. The caller reads from row 2 to
  // avoid this; asserted here so the reason is not lost.
  const asManual = extractManualRows([REGISTRATION_SHEET_HEADERS]);

  assert.equal(asManual.length, 0);
});

test('a hand-typed row that happens to carry an id is treated as the app\'s', () => {
  // The documented rule is "leave Registration ID blank and the row is
  // yours". A coordinator who fills it in loses the row on the next sync,
  // which is why that rule is in the README and in the sheet's own column.
  const manual = extractManualRows([
    ['Walk In Wanda', '', '', '', '', '', '', '', '', '', 'typed-something']
  ]);

  assert.equal(manual.length, 0);
});

test('a manual row is kept whichever column the coordinator filled in', () => {
  // Someone might type only an email, or only a note.
  assert.equal(extractManualRows([['', 'wanda@example.com']]).length, 1);
  assert.equal(
    extractManualRows([['', '', '', '', '', '', '', '', '', 'Brought a friend']]).length,
    1
  );
});

test('a manual row\'s grid part stops at the last app column', () => {
  // Anything further right is the coordinator's and is carried separately, so
  // it must not widen the app's own rectangle.
  const manual = extractManualRows([
    ['Walk In Wanda', '', '', '', '', '', '', '', '', '', '', 'my own column']
  ]);

  assert.equal(manual.length, 1);
  assert.equal(manual[0].length, REGISTRATION_SHEET_HEADERS.length);
});

// The write sequence itself, with a fake Sheets client. These assert the one
// property that protects data a coordinator cannot get back: the clear only
// ever happens when the read that found their rows succeeded, and it only ever
// targets the rows below everything just written.
// `existingRows` is the DATA rows; the header is prepended here, the way the
// real read returns it. `headerExtras` are the coordinator's own column
// headings beside it.
function fakeSheetsClient({ existingRows = [], headerExtras = [], readFails = false } = {}) {
  const calls = [];

  return {
    calls,
    clearValues: async (args) => {
      calls.push(['clearValues', args]);
    },
    readValues: async (args) => {
      calls.push(['readValues', args]);

      if (readFails) {
        throw new Error('The caller does not have permission');
      }

      return [[...REGISTRATION_SHEET_HEADERS, ...headerExtras], ...existingRows];
    },
    writeValues: async (args) => {
      calls.push(['writeValues', args]);
    }
  };
}

function writeCalls(sheetsClient) {
  return sheetsClient.calls.filter(([name]) => name === 'writeValues').map(([, args]) => args);
}

const SHEET = {
  columnCount: 26,
  sheetId: 0,
  sheetTitle: 'Registrations',
  spreadsheetId: 'sheet-1'
};

test('a failed read never reaches the clear', async () => {
  // The whole point. If the read fails we do not know what the coordinator
  // typed, so clearing would destroy it with no undo. The sync is abandoned
  // instead and the sheet is left exactly as it was.
  const sheetsClient = fakeSheetsClient({ readFails: true });

  await assert.rejects(
    writeRegistrationGrid({
      accessToken: 'token',
      registrations: [registration()],
      sheet: SHEET,
      sheetsClient
    }),
    /does not have permission/
  );

  assert.deepEqual(sheetsClient.calls.map(([name]) => name), ['readValues']);
});

test('the read happens before the write', async () => {
  // Reading after writing would read back the rows just written and find no
  // manual ones at all.
  const sheetsClient = fakeSheetsClient();

  await writeRegistrationGrid({
    accessToken: 'token',
    registrations: [registration()],
    sheet: SHEET,
    sheetsClient
  });

  assert.deepEqual(
    sheetsClient.calls.map(([name]) => name),
    ['readValues', 'writeValues', 'clearValues']
  );
});

test('a hand-typed row survives the rewrite, below the synced rows', async () => {
  const sheetsClient = fakeSheetsClient({
    existingRows: [
      ['Ada Lovelace', 'ada@example.com', '', '', 'Registered', '', '', '', '', '', 'reg-1'],
      ['Walk In Wanda', '', '(555) 999-0000', '', 'Registered', '', '', '', '', 'Cash at door', '']
    ]
  });
  const result = await writeRegistrationGrid({
    accessToken: 'token',
    registrations: [
      registration({
        name: 'Ada Lovelace',
        registrationDate: new Date('2026-03-04T12:00:00Z'),
        registrationId: 'reg-1'
      }),
      registration({
        name: 'Grace Hopper',
        registrationDate: new Date('2026-03-06T12:00:00Z'),
        registrationId: 'reg-2'
      })
    ],
    sheet: SHEET,
    sheetsClient
  });

  assert.equal(result.manualRowCount, 1);
  // Grace registered later so she is above Ada, and the hand-entered row sits
  // below both however the synced rows are ordered.
  assert.deepEqual(
    result.gridValues.map((row) => row[COLUMN.Name]),
    ['Name', 'Grace Hopper', 'Ada Lovelace', 'Walk In Wanda']
  );

  // Four rows written: header, two registrations, one walk-in.
  assert.equal(writeCalls(sheetsClient)[0].range, "'Registrations'!A1:K4");
});

test('the clear starts below the manual rows, not below the synced ones', async () => {
  // Off by one here and the clear eats the walk-in that was just written back.
  const sheetsClient = fakeSheetsClient({
    existingRows: [
      ['Walk In Wanda', '', '', '', '', '', '', '', '', '', ''],
      ['Walk In Walter', '', '', '', '', '', '', '', '', '', '']
    ]
  });

  await writeRegistrationGrid({
    accessToken: 'token',
    registrations: [registration()],
    sheet: SHEET,
    sheetsClient
  });

  const [, clearArgs] = sheetsClient.calls.find(([name]) => name === 'clearValues');
  // Header + 1 registration + 2 walk-ins = 4 rows, so the clear begins at 5.
  assert.equal(clearArgs.range, "'Registrations'!A5:K");
});

test('an empty sheet with no registrations still writes the header', async () => {
  const sheetsClient = fakeSheetsClient();
  const result = await writeRegistrationGrid({
    accessToken: 'token',
    registrations: [],
    sheet: SHEET,
    sheetsClient
  });

  assert.deepEqual(result.gridValues, [REGISTRATION_SHEET_HEADERS]);

  const [, clearArgs] = sheetsClient.calls.find(([name]) => name === 'clearValues');
  assert.equal(clearArgs.range, "'Registrations'!A2:K");
});

test('the read covers the whole sheet width, header row included', async () => {
  // From row 1, because the header's own extra cells are the coordinator's
  // column headings. Out to the sheet's full width, because their columns may
  // be anywhere to the right of the grid.
  const sheetsClient = fakeSheetsClient();

  await writeRegistrationGrid({
    accessToken: 'token',
    registrations: [],
    sheet: SHEET,
    sheetsClient
  });

  const [, readArgs] = sheetsClient.calls.find(([name]) => name === 'readValues');

  assert.equal(readArgs.range, "'Registrations'!A1:Z");
  // FORMULA, so a formula a coordinator wrote is not flattened to its value.
  assert.equal(readArgs.valueRenderOption, 'FORMULA');
});

// A coordinator keeps their own columns to the right of the grid - "Called?",
// "Brought food?". Rows reorder on every sync (newest first, so a new
// registration pushes everything down one), so a note held by position would
// end up describing a stranger. These assert it follows its registrant.
function gridRow(name, registrationId, extras = []) {
  const row = new Array(REGISTRATION_SHEET_COLUMN_COUNT).fill('');

  row[COLUMN.Name] = name;
  row[REGISTRATION_ID_COLUMN_INDEX] = registrationId;

  return [...row, ...extras];
}

test('a note follows its registrant when a newer registration pushes it down', () => {
  // Ada was row 2 with "yes" beside her. Grace then registers later, so Grace
  // takes row 2 and Ada moves to row 3 - and "yes" has to move with her.
  const update = buildRegistrationSheetUpdate({
    existingValues: [
      [...REGISTRATION_SHEET_HEADERS, 'Called?'],
      gridRow('Ada Lovelace', 'reg-1', ['yes'])
    ],
    registrations: [
      registration({
        name: 'Ada Lovelace',
        registrationDate: new Date('2026-03-04T12:00:00Z'),
        registrationId: 'reg-1'
      }),
      registration({
        name: 'Grace Hopper',
        registrationDate: new Date('2026-03-06T12:00:00Z'),
        registrationId: 'reg-2'
      })
    ]
  });

  assert.deepEqual(
    update.gridValues.map((row) => row[COLUMN.Name]),
    ['Name', 'Grace Hopper', 'Ada Lovelace']
  );
  // Same row indices: header heading, nothing for Grace, Ada's note on her row.
  assert.deepEqual(update.extraValues, [['Called?'], [''], ['yes']]);
});

test('the coordinator\'s column headings survive', () => {
  const update = buildRegistrationSheetUpdate({
    existingValues: [[...REGISTRATION_SHEET_HEADERS, 'Called?', 'Brought food?']],
    registrations: [registration()]
  });

  assert.deepEqual(update.extraValues[0], ['Called?', 'Brought food?']);
  assert.equal(update.extraColumnCount, 2);
});

test('a hand-entered row keeps its own notes beside it', () => {
  // A manual row travels as a unit, grid cells and extras together, so its
  // note needs no id to be matched by.
  const update = buildRegistrationSheetUpdate({
    existingValues: [
      [...REGISTRATION_SHEET_HEADERS, 'Called?'],
      [...new Array(REGISTRATION_SHEET_COLUMN_COUNT).fill(''), 'rang twice'].map(
        (cell, index) => (index === COLUMN.Name ? 'Walk In Wanda' : cell)
      )
    ],
    registrations: [registration({ registrationId: 'reg-1' })]
  });

  assert.equal(update.manualRowCount, 1);
  assert.equal(update.gridValues.at(-1)[COLUMN.Name], 'Walk In Wanda');
  assert.deepEqual(update.extraValues.at(-1), ['rang twice']);
});

test('a note whose registrant is gone is dropped with them', () => {
  // The registration was hard-deleted, so there is nobody for the note to be
  // about. Keeping it would attach it to whoever landed on that row.
  const update = buildRegistrationSheetUpdate({
    existingValues: [
      [...REGISTRATION_SHEET_HEADERS, 'Called?'],
      gridRow('Ada Lovelace', 'reg-1', ['yes']),
      gridRow('Deleted Person', 'reg-gone', ['stale note'])
    ],
    registrations: [registration({ name: 'Ada Lovelace', registrationId: 'reg-1' })]
  });

  assert.deepEqual(update.gridValues.map((row) => row[COLUMN.Name]), ['Name', 'Ada Lovelace']);
  assert.deepEqual(update.extraValues, [['Called?'], ['yes']]);
});

test('no extra columns means nothing extra is written at all', () => {
  // Cells nobody is using are never touched, so the second write is skipped.
  const update = buildRegistrationSheetUpdate({
    existingValues: [REGISTRATION_SHEET_HEADERS, gridRow('Ada Lovelace', 'reg-1')],
    registrations: [registration({ registrationId: 'reg-1' })]
  });

  assert.equal(update.extraColumnCount, 0);
  assert.deepEqual(update.extraValues, []);
});

test('narrower rows are padded so the written rectangle is square', () => {
  // Sheets truncates trailing blanks, so one registrant having two notes and
  // another having none arrives as rows of different lengths. The API rejects
  // a ragged rectangle.
  const update = buildRegistrationSheetUpdate({
    existingValues: [
      [...REGISTRATION_SHEET_HEADERS, 'Called?', 'Food?'],
      gridRow('Ada Lovelace', 'reg-1', ['yes', 'brownies']),
      gridRow('Grace Hopper', 'reg-2')
    ],
    registrations: [
      registration({
        name: 'Ada Lovelace',
        registrationDate: new Date('2026-03-04T12:00:00Z'),
        registrationId: 'reg-1'
      }),
      registration({
        name: 'Grace Hopper',
        registrationDate: new Date('2026-03-06T12:00:00Z'),
        registrationId: 'reg-2'
      })
    ]
  });

  assert.equal(update.extraColumnCount, 2);
  update.extraValues.forEach((row) => assert.equal(row.length, 2));
  assert.deepEqual(update.extraValues, [['Called?', 'Food?'], ['', ''], ['yes', 'brownies']]);
});

test('a formula in a coordinator column is carried as a formula', () => {
  // The read asks for FORMULA and the extras write goes in as typed, so this
  // round-trips instead of being flattened to the number it evaluated to.
  const update = buildRegistrationSheetUpdate({
    existingValues: [
      [...REGISTRATION_SHEET_HEADERS, 'Owed'],
      gridRow('Ada Lovelace', 'reg-1', ['=H2-I2'])
    ],
    registrations: [registration({ registrationId: 'reg-1' })]
  });

  assert.deepEqual(update.extraValues.at(-1), ['=H2-I2']);
});

test('a stray note with no name on its row is kept, not discarded', () => {
  // Nothing in the app's columns but something in a coordinator's one. We
  // cannot hold its position, but throwing it away loses what they wrote.
  const update = buildRegistrationSheetUpdate({
    existingValues: [
      [...REGISTRATION_SHEET_HEADERS, 'Called?'],
      [...new Array(REGISTRATION_SHEET_COLUMN_COUNT).fill(''), 'who was this?']
    ],
    registrations: []
  });

  assert.equal(update.manualRowCount, 1);
  assert.deepEqual(update.extraValues.at(-1), ['who was this?']);
});

test('partitionExistingGrid keys extras by id and ignores blank rows', () => {
  const { extrasById, headerExtras, manualRows } = partitionExistingGrid([
    [...REGISTRATION_SHEET_HEADERS, 'Called?'],
    gridRow('Ada Lovelace', 'reg-1', ['yes']),
    gridRow('No Note', 'reg-2'),
    [],
    ['', '', '', '', '', '', '', '', '', '', '']
  ]);

  assert.deepEqual(headerExtras, ['Called?']);
  assert.deepEqual([...extrasById.keys()], ['reg-1']);
  assert.deepEqual(extrasById.get('reg-1'), ['yes']);
  assert.equal(manualRows.length, 0);
});

test('an empty sheet partitions into nothing', () => {
  const { extrasById, headerExtras, manualRows } = partitionExistingGrid([]);

  assert.deepEqual(headerExtras, []);
  assert.equal(extrasById.size, 0);
  assert.equal(manualRows.length, 0);
});

test('the coordinator\'s columns are written separately, as typed', () => {
  // Two writes, not one: the app's columns go in RAW so a registrant called
  // "=Bob" is stored rather than executed, while the coordinator's columns go
  // in as typed so a formula they wrote stays a formula. One call cannot do
  // both.
  const sheetsClient = fakeSheetsClient({
    existingRows: [gridRow('Ada Lovelace', 'reg-1', ['yes'])],
    headerExtras: ['Called?']
  });

  return writeRegistrationGrid({
    accessToken: 'token',
    registrations: [registration({ name: 'Ada Lovelace', registrationId: 'reg-1' })],
    sheet: SHEET,
    sheetsClient
  }).then(() => {
    const [grid, extras] = writeCalls(sheetsClient);

    assert.equal(grid.range, "'Registrations'!A1:K2");
    assert.equal(grid.valueInputOption, undefined, 'the grid write takes the RAW default');

    assert.equal(extras.range, "'Registrations'!L1:L2");
    assert.equal(extras.valueInputOption, 'USER_ENTERED');
    assert.deepEqual(extras.values, [['Called?'], ['yes']]);
  });
});

test('with no coordinator columns there is only one write', async () => {
  const sheetsClient = fakeSheetsClient({
    existingRows: [gridRow('Ada Lovelace', 'reg-1')]
  });

  await writeRegistrationGrid({
    accessToken: 'token',
    registrations: [registration({ registrationId: 'reg-1' })],
    sheet: SHEET,
    sheetsClient
  });

  assert.equal(writeCalls(sheetsClient).length, 1);
});

test('the clear reaches across the coordinator\'s columns but no further', async () => {
  // Wide enough to tidy away an orphaned note from a row that has gone, and
  // no wider - clearing the sheet's full width would delete whatever they
  // keep below the table in columns the sync does not manage.
  const sheetsClient = fakeSheetsClient({
    existingRows: [gridRow('Ada Lovelace', 'reg-1', ['yes', 'brownies'])],
    headerExtras: ['Called?', 'Food?']
  });

  await writeRegistrationGrid({
    accessToken: 'token',
    registrations: [registration({ name: 'Ada Lovelace', registrationId: 'reg-1' })],
    sheet: SHEET,
    sheetsClient
  });

  const [, clearArgs] = sheetsClient.calls.find(([name]) => name === 'clearValues');

  // Header + one registration, two coordinator columns: K is the last app
  // column, so L and M are theirs.
  assert.equal(clearArgs.range, "'Registrations'!A3:M");
});

test('a wider sheet is read all the way across', async () => {
  // A coordinator who needed more than the default 26 columns added them, and
  // reading only as far as Z would silently drop what they put past it.
  const sheetsClient = fakeSheetsClient();

  await writeRegistrationGrid({
    accessToken: 'token',
    registrations: [],
    sheet: { ...SHEET, columnCount: 30 },
    sheetsClient
  });

  const [, readArgs] = sheetsClient.calls.find(([name]) => name === 'readValues');

  assert.equal(readArgs.range, "'Registrations'!A1:AD");
});

test('a failed read never reaches either write', async () => {
  // Restated now that there are two writes and the extras one would overwrite
  // notes the read was the only record of.
  const sheetsClient = fakeSheetsClient({ readFails: true });

  await assert.rejects(writeRegistrationGrid({
    accessToken: 'token',
    registrations: [registration()],
    sheet: SHEET,
    sheetsClient
  }));

  assert.equal(writeCalls(sheetsClient).length, 0);
  assert.equal(sheetsClient.calls.filter(([name]) => name === 'clearValues').length, 0);
});

// Which TAB the grid is written into. Matched on the recorded sheetId, never on
// position: a coordinator who adds a tab and drags it to the front would
// otherwise have the registration grid written over it and everything below it
// cleared, with no undo.
const REGISTRATIONS_TAB = { columnCount: 26, sheetId: 0, sheetTitle: 'Registrations' };
const COORDINATOR_TAB = { columnCount: 12, sheetId: 1844, sheetTitle: 'Door list' };

test('the tab is found by its id even when it is no longer first', () => {
  // The whole point of the fix. 'Door list' is at position 0 here.
  const tab = resolveRegistrationTab(
    [COORDINATOR_TAB, REGISTRATIONS_TAB],
    { sheetId: 0 }
  );

  assert.equal(tab.sheetTitle, 'Registrations');
  assert.equal(tab.sheetId, 0);
});

test('sheetId 0 is a real id and must not be treated as missing', () => {
  // Google gives the first tab of a new spreadsheet the id 0, so nearly every
  // sheet here has one. A truthiness check instead of Number.isInteger would
  // send every sync down the "no remembered tab" path and back to picking by
  // position, reintroducing the bug invisibly.
  //
  // Constructed so it can actually tell the two apart: the tab with id 0 is
  // RENAMED, so the title fallback cannot rescue a truthiness check - it would
  // return the coordinator's tab at position 0 instead.
  const renamedWithIdZero = { columnCount: 26, sheetId: 0, sheetTitle: 'Sign-ups' };
  const tab = resolveRegistrationTab([COORDINATOR_TAB, renamedWithIdZero], { sheetId: 0 });

  assert.equal(tab.sheetId, 0, 'sheetId 0 should match by id, not fall through');
  assert.equal(tab.sheetTitle, 'Sign-ups');
});

test('a renamed tab is still found by its id', () => {
  // Renaming is allowed and handled; the id does not change.
  const renamed = { ...REGISTRATIONS_TAB, sheetTitle: 'Sign-ups' };
  const tab = resolveRegistrationTab([COORDINATOR_TAB, renamed], { sheetId: 0 });

  assert.equal(tab.sheetTitle, 'Sign-ups');
});

test('a deleted tab resolves to nothing rather than to someone else\'s', () => {
  // null tells the caller to add a replacement tab. Falling back to tabs[0]
  // here would adopt the coordinator's tab and overwrite it.
  assert.equal(resolveRegistrationTab([COORDINATOR_TAB], { sheetId: 0 }), null);
  assert.equal(resolveRegistrationTab([], { sheetId: 0 }), null);
});

test('with no remembered id, a tab named like ours wins over position', () => {
  // Only reachable for a link document written before the id was recorded.
  const tab = resolveRegistrationTab([COORDINATOR_TAB, REGISTRATIONS_TAB], {});

  assert.equal(tab.sheetTitle, 'Registrations');
});

test('with no remembered id and no match, the only tab is used', () => {
  // Such a spreadsheet was still created by this code, so its single tab is
  // ours whatever it is called.
  const tab = resolveRegistrationTab([{ columnCount: 26, sheetId: 7, sheetTitle: 'Sheet1' }], {});

  assert.equal(tab.sheetId, 7);
  assert.equal(resolveRegistrationTab([], {}), null);
});

test('a replacement tab takes the first free name', () => {
  // Google refuses a duplicate tab title, so this cannot just always ask for
  // 'Registrations'.
  assert.equal(nextAvailableTabTitle([COORDINATOR_TAB]), 'Registrations');
  assert.equal(nextAvailableTabTitle([REGISTRATIONS_TAB]), 'Registrations 2');
  assert.equal(
    nextAvailableTabTitle([
      REGISTRATIONS_TAB,
      { sheetId: 2, sheetTitle: 'Registrations 2' },
      { sheetId: 3, sheetTitle: 'Registrations 3' }
    ]),
    'Registrations 4'
  );
  assert.equal(nextAvailableTabTitle([]), 'Registrations');
});
