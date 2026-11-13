import assert from 'node:assert/strict';
import test from 'node:test';
import { findCoordinatorAssignmentsForUser } from '../api/admin-update-user-profile.js';

// A coordinator assignment stores a copy of the assignee's name, email and
// phone. Renaming the profile left the copy behind, so the old name kept
// showing in Coordinator Assignments. These cases cover the matching, which is
// the part that can silently find nothing and refresh nothing.
function stubDb(docsByUserId) {
  const queries = [];

  return {
    queries,
    collection(name) {
      assert.equal(name, 'coordinatorAssignments');

      return {
        where(field, op, value) {
          assert.equal(field, 'assignedUserId');
          assert.equal(op, '==');
          queries.push(value);

          return {
            get: async () => ({ docs: docsByUserId[value] || [] })
          };
        }
      };
    }
  };
}

test('an assignment recorded against the profile id is found', async () => {
  const db = stubDb({ 'profile-1': [{ id: 'programs', ref: 'programs-ref' }] });

  const found = await findCoordinatorAssignmentsForUser(db, 'profile-1', 'auth-uid-1');

  assert.deepEqual(found.map((item) => item.id), ['programs']);
});

test('an assignment recorded against the auth uid is found too', async () => {
  // saveCoordinatorAssignment writes `profile.userId || profile.id`, and an
  // imported member has a profile document before it has an Auth uid - so the
  // stored id can be either one.
  const db = stubDb({ 'auth-uid-1': [{ id: 'workshops', ref: 'workshops-ref' }] });

  const found = await findCoordinatorAssignmentsForUser(db, 'profile-1', 'auth-uid-1');

  assert.deepEqual(found.map((item) => item.id), ['workshops']);
});

test('the same assignment found under both ids is returned once', async () => {
  const doc = { id: 'programs', ref: 'programs-ref' };
  const db = stubDb({ 'profile-1': [doc], 'auth-uid-1': [doc] });

  const found = await findCoordinatorAssignmentsForUser(db, 'profile-1', 'auth-uid-1');

  assert.equal(found.length, 1, 'a duplicate would be written twice in one batch');
});

test('identical ids are queried once, not twice', async () => {
  const db = stubDb({ 'profile-1': [] });

  await findCoordinatorAssignmentsForUser(db, 'profile-1', 'profile-1');

  assert.deepEqual(db.queries, ['profile-1']);
});

test('an empty id is not queried', async () => {
  const db = stubDb({ 'profile-1': [] });

  await findCoordinatorAssignmentsForUser(db, 'profile-1', '');

  assert.deepEqual(db.queries, ['profile-1']);
});

test('no assignment for this member is not an error', async () => {
  const db = stubDb({});

  const found = await findCoordinatorAssignmentsForUser(db, 'profile-1', 'auth-uid-1');

  assert.deepEqual(found, []);
});
