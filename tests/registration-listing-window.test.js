import assert from 'node:assert/strict';
import test from 'node:test';
import { getRegistrationListingConflicts } from '../shared/registrationWindow.js';

// Registration is gated on the listing being visible, so a registration date
// outside the listing window produces a stretch where the dates read "open"
// and every attempt is refused. These are the two ways out of the window.
function event(overrides = {}) {
  return {
    eventType: 'Workshop',
    registrationCloseAt: '2026-12-05T17:00',
    registrationMode: 'future',
    registrationOpenAt: '2026-11-30T09:00',
    visibleFrom: '2026-11-30T09:00',
    visibleUntil: '2026-12-12T23:59',
    ...overrides
  };
}

test('a registration window inside the listing window is accepted', () => {
  assert.deepEqual(getRegistrationListingConflicts(event()), []);
});

test('registration ending before the listing is removed is fine, not a conflict', () => {
  // The case the user named: register by the 1st, leave the details up until
  // after the event. Containment, not equality.
  assert.deepEqual(
    getRegistrationListingConflicts(event({ registrationCloseAt: '2026-12-01T12:00' })),
    []
  );
});

test('registration opening before the listing appears is a conflict', () => {
  const conflicts = getRegistrationListingConflicts(
    event({ registrationOpenAt: '2026-11-13T09:00' })
  );

  assert.deepEqual(conflicts.map((item) => item.kind), ['opens-before-listing']);
  assert.equal(conflicts[0].field, 'registrationOpenAt');
});

test('registration still open after the listing is removed is a conflict', () => {
  const conflicts = getRegistrationListingConflicts(
    event({ registrationCloseAt: '2026-12-20T09:00' })
  );

  assert.deepEqual(conflicts.map((item) => item.kind), ['closes-after-listing']);
  assert.equal(conflicts[0].field, 'registrationCloseAt');
});

test('both ends wrong reports both', () => {
  const conflicts = getRegistrationListingConflicts(
    event({ registrationCloseAt: '2026-12-20T09:00', registrationOpenAt: '2026-11-01T09:00' })
  );

  assert.deepEqual(
    conflicts.map((item) => item.kind),
    ['opens-before-listing', 'closes-after-listing']
  );
});

test('a listing that goes up immediately has no lower bound to breach', () => {
  // listingMode 'now' leaves visibleFrom empty, so a registration date in the
  // past is ordinary rather than a conflict.
  assert.deepEqual(
    getRegistrationListingConflicts(
      event({ registrationOpenAt: '2020-01-01T09:00', visibleFrom: '' })
    ),
    []
  );
});

test('an event that takes no registrations is never in conflict', () => {
  assert.deepEqual(
    getRegistrationListingConflicts(
      event({ registrationMode: 'none', registrationOpenAt: '2026-01-01T09:00' })
    ),
    []
  );
});

test('the boundary instant is allowed at both ends', () => {
  // Registration opening exactly when the listing appears, and closing exactly
  // when it is removed, are both legitimate - the gate is inclusive.
  assert.deepEqual(
    getRegistrationListingConflicts(
      event({ registrationCloseAt: '2026-12-12T23:59', registrationOpenAt: '2026-11-30T09:00' })
    ),
    []
  );
});

test('a missing date is not a conflict', () => {
  assert.deepEqual(
    getRegistrationListingConflicts(event({ registrationCloseAt: '', registrationOpenAt: '' })),
    []
  );
  assert.deepEqual(getRegistrationListingConflicts(event({ visibleUntil: '' })), []);
});

test('no event at all is not a conflict', () => {
  assert.deepEqual(getRegistrationListingConflicts(null), []);
});
