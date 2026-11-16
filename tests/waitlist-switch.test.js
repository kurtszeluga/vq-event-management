import assert from 'node:assert/strict';
import test from 'node:test';
import { isWaitlistEnabled } from '../shared/registrationWindow.js';
import { getInitialRegistrationStatus } from '../api/_lib/registration-capacity.js';

test('an event with no waitlistEnabled field still has a waitlist', () => {
  // The whole reason this reads "not switched off" rather than "switched on".
  // Every event in both Firebase projects predates the field; a truthiness
  // test would have removed the waitlist from all of them at once, silently,
  // on deploy.
  assert.equal(isWaitlistEnabled({}), true);
  assert.equal(isWaitlistEnabled({ eventType: 'Workshop' }), true);
  assert.equal(isWaitlistEnabled({ waitlistEnabled: undefined }), true);
  assert.equal(isWaitlistEnabled(null), true);
});

test('only an explicit false turns it off', () => {
  assert.equal(isWaitlistEnabled({ waitlistEnabled: false }), false);
  assert.equal(isWaitlistEnabled({ waitlistEnabled: true }), true);
});

test('a full event queues people only when the waitlist is on', () => {
  const full = { hasCapacity: false, isPaidEvent: true, payLaterByCashCheck: false };

  assert.equal(getInitialRegistrationStatus({ ...full, waitlistEnabled: true }), 'Waitlisted');
  // Not 'Waitlisted'. The callers refuse this case outright; returning a
  // status nothing treats as holding a seat means a caller that forgets to
  // refuse cannot quietly queue someone on a waitlist that does not exist.
  assert.equal(getInitialRegistrationStatus({ ...full, waitlistEnabled: false }), 'Full');
});

test('the switch changes nothing for an event with a seat free', () => {
  const open = { hasCapacity: true, isPaidEvent: true, payLaterByCashCheck: false };

  assert.equal(getInitialRegistrationStatus({ ...open, waitlistEnabled: true }), 'Pending Payment');
  assert.equal(getInitialRegistrationStatus({ ...open, waitlistEnabled: false }), 'Pending Payment');

  const free = { hasCapacity: true, isPaidEvent: false, payLaterByCashCheck: false };

  assert.equal(getInitialRegistrationStatus({ ...free, waitlistEnabled: false }), 'Registered');
});

test('the default argument keeps every existing caller behaving as before', () => {
  // getInitialRegistrationStatus is called from more than one place; an
  // omitted flag must mean "waitlist", not "full".
  assert.equal(
    getInitialRegistrationStatus({ hasCapacity: false, isPaidEvent: false, payLaterByCashCheck: false }),
    'Waitlisted'
  );
});
