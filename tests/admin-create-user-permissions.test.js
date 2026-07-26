import assert from 'node:assert/strict';
import test from 'node:test';
import { getPermissionsForRole } from '../api/admin-create-user.js';

// Confirmed the sibling admin-update-user-profile.js has this same 5->6 key
// function, independently duplicated rather than shared - so both need this
// exact coverage, since a fix to one does not protect the other.
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

  assert.deepEqual(Object.keys(result).sort(), [
    'addUsers',
    'manageEvents',
    'manageMembershipStatus',
    'managePayments',
    'registerOthers',
    'viewRegistrations'
  ]);
  assert.equal(result.manageEvents, true);
});
