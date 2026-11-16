import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MEMBERSHIP_ANSWER_HEADERS,
  MEMBERSHIP_REGISTRATION_SHEET_HEADERS,
  REGISTRATION_SHEET_HEADERS,
  buildRegistrationSheetRow,
  buildRegistrationSheetUpdate,
  getRegistrationIdColumnIndex,
  getRegistrationSheetHeaders
} from '../shared/eventRegistrationSheet.js';

const MEMBERSHIP_EVENT = { eventType: 'Membership' };
const CLASS_EVENT = { eventType: 'Class (Half Day)' };

const MEMBERSHIP_REGISTRATION = {
  amountDue: 25,
  amountPaid: 25,
  email: 'ada@example.com',
  membershipPhoneType: 'cell',
  membershipRenewalType: 'renewing',
  membershipSkills: 'Longarm   quilting\nand binding',
  membershipVeteran: 'yes',
  name: 'Ada Lovelace',
  paymentStatus: 'Paid',
  phone: '(865) 555-0100',
  registrationDate: '2026-08-02T15:00:00.000Z',
  registrationId: 'reg-1',
  status: 'Registered'
};

test('every other event type keeps the exact eleven-column header it already had', () => {
  // The guarantee this file exists for. Widening the shared header would shift
  // every coordinator's hand-added columns four places on the next sync and
  // overwrite the first four of them, on every existing sheet at once.
  assert.deepEqual(getRegistrationSheetHeaders(CLASS_EVENT), REGISTRATION_SHEET_HEADERS);
  assert.deepEqual(getRegistrationSheetHeaders(null), REGISTRATION_SHEET_HEADERS);
  assert.equal(REGISTRATION_SHEET_HEADERS.length, 11);
});

test('a membership sheet carries the four answers beside Phone', () => {
  const headers = getRegistrationSheetHeaders(MEMBERSHIP_EVENT);

  assert.deepEqual(headers, MEMBERSHIP_REGISTRATION_SHEET_HEADERS);
  assert.equal(headers.length, REGISTRATION_SHEET_HEADERS.length + 4);
  assert.deepEqual(
    headers.slice(headers.indexOf('Phone') + 1, headers.indexOf('Phone') + 5),
    MEMBERSHIP_ANSWER_HEADERS
  );
  // Registration ID stays last, so the rule that identifies an app-written row
  // still reads "the final app column".
  assert.equal(headers[headers.length - 1], 'Registration ID');
});

test('the registration id column index is derived, not assumed', () => {
  assert.equal(getRegistrationIdColumnIndex(REGISTRATION_SHEET_HEADERS), 10);
  assert.equal(getRegistrationIdColumnIndex(MEMBERSHIP_REGISTRATION_SHEET_HEADERS), 14);
});

test('a membership row writes the answers as their labels, not their stored values', () => {
  const row = buildRegistrationSheetRow(MEMBERSHIP_REGISTRATION, { event: MEMBERSHIP_EVENT });
  const headers = getRegistrationSheetHeaders(MEMBERSHIP_EVENT);

  assert.equal(row.length, headers.length);
  assert.equal(row[headers.indexOf('Phone Type')], 'Cell Phone (Mobile)');
  assert.equal(row[headers.indexOf('New Or Renewing')], 'Renewing Membership');
  assert.equal(row[headers.indexOf('Veteran')], 'Yes');
  // Collapsed, because a newline inside a cell makes the row unreadable in the
  // sheet's default row height.
  assert.equal(row[headers.indexOf('Skills To Share')], 'Longarm quilting and binding');
});

test('a non-membership row is byte-for-byte what it was before', () => {
  const classRegistration = { ...MEMBERSHIP_REGISTRATION };
  const withEvent = buildRegistrationSheetRow(classRegistration, { event: CLASS_EVENT });
  const withoutEvent = buildRegistrationSheetRow(classRegistration);

  assert.deepEqual(withEvent, withoutEvent);
  assert.equal(withEvent.length, REGISTRATION_SHEET_HEADERS.length);
  // The membership answers are on the registration record but must not appear.
  assert.ok(!withEvent.includes('Cell Phone (Mobile)'));
});

test("a coordinator's own columns survive a membership sync at the wider offset", () => {
  const headers = getRegistrationSheetHeaders(MEMBERSHIP_EVENT);
  const existingRow = [...headers.map(() => '')];

  existingRow[getRegistrationIdColumnIndex(headers)] = 'reg-1';

  const existingValues = [
    [...headers, 'Called?'],
    [...existingRow, 'yes']
  ];
  const update = buildRegistrationSheetUpdate({
    event: MEMBERSHIP_EVENT,
    existingValues,
    registrations: [MEMBERSHIP_REGISTRATION]
  });

  assert.equal(update.columnCount, headers.length);
  assert.equal(update.extraColumnCount, 1);
  assert.deepEqual(update.extraValues, [['Called?'], ['yes']]);
  assert.equal(update.manualRowCount, 0);
  assert.equal(update.registrationRowCount, 1);
});

test('a walk-in typed into a membership sheet is still recognised as the coordinator\'s', () => {
  const headers = getRegistrationSheetHeaders(MEMBERSHIP_EVENT);
  const typedRow = headers.map(() => '');

  typedRow[0] = 'Grace Hopper';
  typedRow[headers.indexOf('Phone Type')] = 'Home Phone';

  const update = buildRegistrationSheetUpdate({
    event: MEMBERSHIP_EVENT,
    existingValues: [headers, typedRow],
    registrations: []
  });

  assert.equal(update.manualRowCount, 1);
  assert.equal(update.gridValues[1][0], 'Grace Hopper');
});

test('the update reports the width it wrote, so the clear cannot overreach', () => {
  // The clear range is built from columnCount. Reporting the narrow width on a
  // membership sheet would leave four columns of a shrunken list behind; the
  // wide width on a class sheet would clear into a coordinator's columns.
  assert.equal(
    buildRegistrationSheetUpdate({ event: MEMBERSHIP_EVENT, registrations: [] }).columnCount,
    15
  );
  assert.equal(
    buildRegistrationSheetUpdate({ event: CLASS_EVENT, registrations: [] }).columnCount,
    11
  );
  assert.equal(buildRegistrationSheetUpdate({ registrations: [] }).columnCount, 11);
});
