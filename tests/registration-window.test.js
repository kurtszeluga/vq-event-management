import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GUILD_TIME_ZONE,
  getRegistrationWindowState,
  isRegistrationWindowInverted,
  isRegistrationWindowOpen,
  parseGuildDateTime
} from '../shared/registrationWindow.js';

const UTC = (text) => Date.parse(text);

test('the guild zone is the one the club actually sits in', () => {
  assert.equal(GUILD_TIME_ZONE, 'America/New_York');
});

// These are the tests that matter most. The admin form writes naive
// 'YYYY-MM-DDTHH:mm' strings, the browser is usually Eastern and Vercel is UTC,
// and Date.parse on a naive string uses whichever zone the runtime is in. If
// these regress, registration opens and closes hours away from what the admin
// configured, on the server only.
test('a naive summer datetime resolves as Eastern Daylight Time, not as the runtime zone', () => {
  // 2026-07-19 is inside US DST, so Eastern is UTC-4.
  assert.equal(parseGuildDateTime('2026-07-19T09:00'), UTC('2026-07-19T13:00:00Z'));
});

test('a naive winter datetime resolves as Eastern Standard Time', () => {
  // 2026-01-15 is outside US DST, so Eastern is UTC-5.
  assert.equal(parseGuildDateTime('2026-01-15T09:00'), UTC('2026-01-15T14:00:00Z'));
});

test('the offset is measured per date, so a single fixed offset cannot pass', () => {
  const summer = parseGuildDateTime('2026-07-19T09:00');
  const winter = parseGuildDateTime('2026-01-15T09:00');

  // Same wall clock, one hour apart in absolute terms because of DST.
  assert.equal((winter - UTC('2026-01-15T00:00:00Z')) - (summer - UTC('2026-07-19T00:00:00Z')), 3600000);
});

test('resolution is pinned to an explicit zone, not inherited from the runtime', () => {
  // One naive string, three zones, three different instants. This is the
  // regression that would otherwise only appear in production: Vercel runs UTC,
  // so a runtime-local parse there reads 09:00 as 09:00Z instead of 13:00Z and
  // closes registration four hours early.
  assert.equal(parseGuildDateTime('2026-07-19T09:00', 'America/New_York'), UTC('2026-07-19T13:00:00Z'));
  assert.equal(parseGuildDateTime('2026-07-19T09:00', 'UTC'), UTC('2026-07-19T09:00:00Z'));
  assert.equal(parseGuildDateTime('2026-07-19T09:00', 'Asia/Tokyo'), UTC('2026-07-19T00:00:00Z'));

  // And the default is the guild zone specifically.
  assert.equal(
    parseGuildDateTime('2026-07-19T09:00'),
    parseGuildDateTime('2026-07-19T09:00', 'America/New_York')
  );
});

test('dates either side of a DST transition both resolve correctly', () => {
  // US DST 2026: starts 08 Mar, ends 01 Nov.
  assert.equal(parseGuildDateTime('2026-03-07T12:00'), UTC('2026-03-07T17:00:00Z'));
  assert.equal(parseGuildDateTime('2026-03-09T12:00'), UTC('2026-03-09T16:00:00Z'));
  assert.equal(parseGuildDateTime('2026-10-31T12:00'), UTC('2026-10-31T16:00:00Z'));
  assert.equal(parseGuildDateTime('2026-11-02T12:00'), UTC('2026-11-02T17:00:00Z'));
});

// The cases above are far enough from the transition that measuring the offset
// once is already right. These two are not: the naive value and the instant it
// resolves to fall on opposite sides of the changeover, so a single-pass
// implementation lands an hour out. They are what justifies re-measuring.
test('a time inside a DST changeover needs the offset re-measured', () => {
  // Spring forward: 08 Mar 2026, 02:00 EST becomes 03:00 EDT.
  // 04:00 local is EDT (UTC-4) = 08:00Z. Measuring once yields 09:00Z.
  assert.equal(parseGuildDateTime('2026-03-08T04:00'), UTC('2026-03-08T08:00:00Z'));

  // Fall back: 01 Nov 2026, 02:00 EDT becomes 01:00 EST.
  // 03:00 local is EST (UTC-5) = 08:00Z. Measuring once yields 07:00Z.
  assert.equal(parseGuildDateTime('2026-11-01T03:00'), UTC('2026-11-01T08:00:00Z'));
});

test('a date-only value is read as midnight guild time', () => {
  assert.equal(parseGuildDateTime('2026-07-19'), UTC('2026-07-19T04:00:00Z'));
});

test('an explicit zone in the string is respected rather than re-interpreted', () => {
  assert.equal(parseGuildDateTime('2026-07-19T13:00:00Z'), UTC('2026-07-19T13:00:00Z'));
  assert.equal(parseGuildDateTime('2026-07-19T09:00:00-04:00'), UTC('2026-07-19T13:00:00Z'));
});

test('Firestore timestamps, Dates, and epoch numbers are accepted', () => {
  const instant = UTC('2026-07-19T13:00:00Z');

  assert.equal(parseGuildDateTime({ toDate: () => new Date(instant) }), instant);
  assert.equal(parseGuildDateTime(new Date(instant)), instant);
  assert.equal(parseGuildDateTime(instant), instant);
});

test('missing and unparseable values return null rather than NaN or 0', () => {
  for (const value of [null, undefined, '', '   ', 'not a date', new Date('nope'), Number.NaN]) {
    assert.equal(parseGuildDateTime(value), null, `expected null for ${String(value)}`);
  }
});

function eventWithWindow(overrides = {}) {
  return {
    eventType: 'Workshop',
    registrationMode: 'now',
    registrationOpenAt: '2026-07-01T09:00',
    registrationCloseAt: '2026-07-20T17:00',
    ...overrides
  };
}

const DURING = UTC('2026-07-10T12:00:00Z');
const BEFORE = UTC('2026-06-01T12:00:00Z');
const AFTER = UTC('2026-08-01T12:00:00Z');

test('registration is open inside the window', () => {
  assert.equal(getRegistrationWindowState(eventWithWindow(), { now: DURING }).state, 'open');
  assert.equal(isRegistrationWindowOpen(eventWithWindow(), { now: DURING }), true);
});

test('registration has not opened before the start date', () => {
  assert.equal(getRegistrationWindowState(eventWithWindow(), { now: BEFORE }).state, 'not-yet-open');
});

test('registration is closed after the end date', () => {
  assert.equal(getRegistrationWindowState(eventWithWindow(), { now: AFTER }).state, 'closed');
});

// The two bugs this module exists to fix. Both stored booleans below are what
// EventForm actually writes, and both were the only thing the old gate read.
test('a "now" event closes at its end date even though registrationOpen is stored true', () => {
  const event = eventWithWindow({ registrationMode: 'now', registrationOpen: true });

  assert.equal(getRegistrationWindowState(event, { now: AFTER }).state, 'closed');
  assert.equal(isRegistrationWindowOpen(event, { now: AFTER }), false);
});

test('a "future" event opens at its start date even though registrationOpen is stored false', () => {
  const event = eventWithWindow({ registrationMode: 'future', registrationOpen: false });

  assert.equal(getRegistrationWindowState(event, { now: DURING }).state, 'open');
  assert.equal(isRegistrationWindowOpen(event, { now: DURING }), true);
});

test('registration mode none or unset is disabled regardless of dates', () => {
  for (const registrationMode of ['none', '', undefined]) {
    const event = eventWithWindow({ registrationMode });
    assert.equal(getRegistrationWindowState(event, { now: DURING }).state, 'disabled');
  }
});

test('listings never accept registrations even with a live window', () => {
  for (const eventType of ['Business Listing', 'For Sale']) {
    const event = eventWithWindow({ eventType });
    assert.equal(getRegistrationWindowState(event, { now: DURING }).state, 'not-registrable');
  }
});

test('a "future" event with no usable open date stays closed instead of defaulting open', () => {
  const event = eventWithWindow({ registrationMode: 'future', registrationOpenAt: '' });

  assert.equal(getRegistrationWindowState(event, { now: DURING }).state, 'disabled');
});

test('a "now" event with no open date is open until its close date', () => {
  const open = eventWithWindow({ registrationOpenAt: '' });

  assert.equal(getRegistrationWindowState(open, { now: DURING }).state, 'open');
  assert.equal(getRegistrationWindowState(open, { now: AFTER }).state, 'closed');
});

test('a "now" event with no close date does not spontaneously close', () => {
  const event = eventWithWindow({ registrationCloseAt: '' });

  assert.equal(getRegistrationWindowState(event, { now: AFTER }).state, 'open');
});

test('the boundary instants are inclusive at both ends', () => {
  const event = eventWithWindow();
  const opensAt = parseGuildDateTime('2026-07-01T09:00');
  const closesAt = parseGuildDateTime('2026-07-20T17:00');

  assert.equal(getRegistrationWindowState(event, { now: opensAt }).state, 'open');
  assert.equal(getRegistrationWindowState(event, { now: opensAt - 1 }).state, 'not-yet-open');
  assert.equal(getRegistrationWindowState(event, { now: closesAt }).state, 'open');
  assert.equal(getRegistrationWindowState(event, { now: closesAt + 1 }).state, 'closed');
});

test('the resolved boundaries come back so callers can name the date', () => {
  const { opensAt, closesAt } = getRegistrationWindowState(eventWithWindow(), { now: DURING });

  assert.equal(opensAt, UTC('2026-07-01T13:00:00Z'));
  assert.equal(closesAt, UTC('2026-07-20T21:00:00Z'));
});

test('an inverted window is detectable, a valid one is not', () => {
  assert.equal(isRegistrationWindowInverted({
    registrationOpenAt: '2026-07-19T09:00',
    registrationCloseAt: '2026-07-13T09:00'
  }), true);

  assert.equal(isRegistrationWindowInverted({
    registrationOpenAt: '2026-07-01T09:00',
    registrationCloseAt: '2026-07-20T17:00'
  }), false);

  // Equal instants leave a zero-length window, which is not a usable range.
  assert.equal(isRegistrationWindowInverted({
    registrationOpenAt: '2026-07-01T09:00',
    registrationCloseAt: '2026-07-01T09:00'
  }), true);

  // A half-configured window is not "inverted", just incomplete.
  assert.equal(isRegistrationWindowInverted({ registrationOpenAt: '2026-07-01T09:00' }), false);
});
