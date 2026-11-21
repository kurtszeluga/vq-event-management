import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CHALLENGE_EVENT_TYPES,
  PROGRAM_EVENT_TYPES,
  getEventTypePermissionKey,
  getManageableEventTypes,
  isChallengeEventType,
  isProgramEventType
} from '../shared/eventTypes.js';
import { EVENT_TYPES } from '../src/data/eventOptions.js';
import { USER_PERMISSION_OPTIONS } from '../src/data/userRoles.js';

// Programs was split out of Manage Events so permissions can be handed out a
// chunk at a time rather than all at once. The split is enforced in two
// places - the admin dashboard decides which tabs and types an account sees,
// and /api/admin-manage-event decides what it may write - so the list lives in
// shared/ and these tests pin the things that would silently diverge.

test('Programs is both class types and lectures', () => {
  assert.deepEqual(PROGRAM_EVENT_TYPES, [
    'Class (Half Day)',
    'Class (Full Day)',
    'Lecture'
  ]);
});

test('every program type is a real event type', () => {
  // A typo here would produce a tab that lists nothing and a permission that
  // grants nothing, with no error anywhere.
  for (const type of PROGRAM_EVENT_TYPES) {
    assert.ok(EVENT_TYPES.includes(type), `${type} is not in EVENT_TYPES`);
  }
});

test('the event tabs between them cover every type exactly once', () => {
  // The dashboard builds each tab by exclusion from EVENT_TYPES. If a type
  // ever fell through both lists it would become unmanageable from the admin
  // UI without anything failing.
  const listingTypes = ['Business Listing', 'For Sale', 'Challenges', 'Membership'];
  const workshopTypes = ['Workshop'];
  const activityTypes = EVENT_TYPES.filter(
    (type) => !PROGRAM_EVENT_TYPES.includes(type)
      && !listingTypes.includes(type)
      && !workshopTypes.includes(type)
  );

  // Workshop has a tab of its own as of 2026-11-21, so Retreats/Other Events
  // is what is left after it.
  assert.deepEqual(activityTypes, ['Retreat', 'Other']);

  const covered = [
    ...PROGRAM_EVENT_TYPES,
    ...workshopTypes,
    ...activityTypes,
    ...listingTypes
  ].sort();

  assert.deepEqual(covered, [...EVENT_TYPES].sort());
});

test('every event type belongs to exactly one permission', () => {
  // The server reads this map to decide what an account may write, so a type
  // resolving to a key nobody can hold would be silently unmanageable.
  const keys = ['managePrograms', 'manageChallenges', 'manageEvents'];

  for (const type of EVENT_TYPES) {
    assert.ok(
      keys.includes(getEventTypePermissionKey(type)),
      `${type} resolves to an unknown permission`
    );
  }

  assert.equal(getEventTypePermissionKey('Lecture'), 'managePrograms');
  assert.equal(getEventTypePermissionKey('Challenges'), 'manageChallenges');
  assert.equal(getEventTypePermissionKey('Workshop'), 'manageEvents');
  assert.equal(getEventTypePermissionKey('Membership'), 'manageEvents');
  // An unknown type falls to the broad permission rather than to nothing,
  // which is the safe direction: an events admin already holds it.
  assert.equal(getEventTypePermissionKey('Something New'), 'manageEvents');
});

test('Challenges is a scope of its own', () => {
  assert.deepEqual(CHALLENGE_EVENT_TYPES, ['Challenges']);
  assert.equal(isChallengeEventType('Challenges'), true);
  assert.equal(isChallengeEventType('  Challenges  '), true);
  assert.equal(isChallengeEventType('challenges'), false);
  assert.equal(isChallengeEventType('Workshop'), false);
  assert.equal(isChallengeEventType(''), false);
  assert.equal(isChallengeEventType(null), false);
});

test('a Challenges-only admin may create nothing else', () => {
  assert.deepEqual(
    getManageableEventTypes(EVENT_TYPES, { manageChallenges: true }),
    ['Challenges']
  );
  // And the events permission no longer reaches Challenges - that is the
  // whole point of splitting it.
  assert.ok(
    !getManageableEventTypes(EVENT_TYPES, { manageEvents: true }).includes('Challenges')
  );
  assert.deepEqual(
    getManageableEventTypes(EVENT_TYPES, { managePrograms: true }),
    PROGRAM_EVENT_TYPES
  );
});

test('isProgramEventType is exact, and survives junk', () => {
  assert.equal(isProgramEventType('Lecture'), true);
  assert.equal(isProgramEventType('  Lecture  '), true);
  assert.equal(isProgramEventType('Workshop'), false);
  assert.equal(isProgramEventType('Retreat'), false);
  assert.equal(isProgramEventType('Business Listing'), false);
  // Case matters: these strings are stored values, not user input.
  assert.equal(isProgramEventType('lecture'), false);
  assert.equal(isProgramEventType(''), false);
  assert.equal(isProgramEventType(null), false);
  assert.equal(isProgramEventType(undefined), false);
});

test('all three event permissions exist and say which tabs they open', () => {
  const programs = USER_PERMISSION_OPTIONS.find((o) => o.key === 'managePrograms');
  const events = USER_PERMISSION_OPTIONS.find((o) => o.key === 'manageEvents');

  const challenges = USER_PERMISSION_OPTIONS.find((o) => o.key === 'manageChallenges');

  assert.ok(programs, 'managePrograms is missing from the permission list');
  assert.ok(challenges, 'manageChallenges is missing from the permission list');
  assert.match(programs.description, /Programs tab/);
  assert.match(challenges.description, /Challenges tab/);
  // The old breadth problem in reverse: this one must say what it no longer
  // covers, or it reads as still including classes and challenges.
  assert.match(events.description, /does NOT include Programs/i);
  assert.match(events.description, /Challenges/);
});
