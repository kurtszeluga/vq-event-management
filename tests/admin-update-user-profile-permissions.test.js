import assert from 'node:assert/strict';
import test from 'node:test';
import { getPermissionsForRole } from '../api/admin-update-user-profile.js';

// Independently duplicated from admin-create-user.js's identically-named
// function - no shared code between the two files, so this needs its own
// coverage rather than trusting the sibling test.
test('an Admin role carries registerOthers through unchanged', () => {
  assert.equal(
    getPermissionsForRole('Admin', { registerOthers: true }).registerOthers,
    true
  );
  assert.equal(
    getPermissionsForRole('Admin', { registerOthers: false }).registerOthers,
    false
  );
});

test('a General User is forced to false even if the input claims true', () => {
  assert.equal(
    getPermissionsForRole('General User', { registerOthers: true }).registerOthers,
    false
  );
});

test('every other existing permission key is still present alongside the new one', () => {
  const result = getPermissionsForRole('Admin', { manageEvents: true, registerOthers: true });

  // Has to stay in step with USER_PERMISSION_OPTIONS and with the hasOnly()
  // list in firestore.rules - a key written here that the rules do not accept
  // makes the document unwritable from the client afterwards.
  assert.deepEqual(Object.keys(result).sort(), [
    'addUsers',
    'manageEvents',
    'manageMembershipStatus',
    'managePayments',
    'manageWaitlist',
    'registerOthers',
    'viewRegistrations'
  ]);
  assert.equal(result.manageEvents, true);
});

test('a lapsed Admin demoted to General User keeps none of its flags', () => {
  // The demotion is decided by getAllowedRoleForMembership() before this runs,
  // so the payload still carries the admin flags the form last held.
  const result = getPermissionsForRole('General User', {
    manageEvents: true,
    manageWaitlist: true,
    viewRegistrations: true
  });

  assert.deepEqual(
    Object.values(result).filter(Boolean),
    [],
    'a demoted profile must not keep any permission set'
  );
});

test('a Super User reads back as holding everything', () => {
  // Its authority never comes from the map, but the profile screen and user
  // list read it, so a false flag only misreports what the account can do.
  const result = getPermissionsForRole('Super User', {});

  assert.deepEqual(
    Object.values(result).filter((value) => value !== true),
    [],
    'a Super User must not carry a false permission'
  );
});
