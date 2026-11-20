import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PROFILE_TAGS,
  SERVICE_ACCOUNT_TAG,
  applyServiceAccountLock,
  isServiceAccount,
  normalizeProfileTags
} from '../shared/profileTags.js';
import { isEligibleForMemberDirectory } from '../api/_lib/member-directory-profile.js';

// A service account is a standing guild mailbox - programs@, workshops@ -
// that runs part of the guild rather than belonging to a person.
//
// The reason it needs marking at all: the Annual Refresh marks every profile
// missing from the CSV as Inactive, and an Inactive membership demotes an
// Admin to General User with its permissions cleared. A role mailbox will
// never be in the roster, so without this it would be shut down every January.

const SERVICE_ACCOUNT = {
  email: 'programs@villagequilters.com',
  id: 'svc-1',
  membershipStatus: 'Active',
  profileTags: [SERVICE_ACCOUNT_TAG],
  role: 'Admin',
  status: 'Active'
};
const MEMBER = {
  email: 'ada@example.com',
  id: 'member-1',
  membershipStatus: 'Active',
  profileTags: [],
  role: 'General User',
  status: 'Active'
};

test('serviceAccount is the only tag that exists', () => {
  // vqBooking and vqHosting are gone: nothing branched on either, and a list
  // where only one tag means anything invites the other kind back.
  assert.deepEqual(PROFILE_TAGS, ['serviceAccount']);
  assert.deepEqual(normalizeProfileTags(['vqBooking', 'vqHosting']), []);
  assert.deepEqual(normalizeProfileTags(['serviceAccount']), ['serviceAccount']);
  assert.deepEqual(normalizeProfileTags('not an array'), []);
  assert.deepEqual(normalizeProfileTags(), []);
});

test('isServiceAccount reads the tag and nothing else', () => {
  assert.equal(isServiceAccount(SERVICE_ACCOUNT), true);
  assert.equal(isServiceAccount(MEMBER), false);
  // Not inferred from the address or the role - only the tag says it.
  assert.equal(isServiceAccount({ email: 'programs@villagequilters.com' }), false);
  assert.equal(isServiceAccount({ role: 'Admin' }), false);
  assert.equal(isServiceAccount({}), false);
  assert.equal(isServiceAccount(), false);
});

test('the lock pins the three fields that could switch the account off', () => {
  const locked = applyServiceAccountLock(SERVICE_ACCOUNT, {
    membershipPaymentStatus: 'Pending',
    membershipStatus: 'Inactive',
    name: 'Programs',
    status: 'Archived'
  });

  assert.equal(locked.membershipStatus, 'Active');
  assert.equal(locked.status, 'Active');
  assert.equal(locked.membershipPaymentStatus, 'Waived');
  // Everything else is left exactly as the caller built it.
  assert.equal(locked.name, 'Programs');
});

test('the lock leaves an ordinary member alone', () => {
  const payload = {
    membershipPaymentStatus: 'Pending',
    membershipStatus: 'Inactive',
    status: 'Active'
  };

  assert.deepEqual(applyServiceAccountLock(MEMBER, payload), payload);
});

// The annual refresh assertions live in
// tests/client/serviceAccountRoster.test.js: getProfilesMissingFromImport
// comes from configurationService, which imports the Firebase client and so
// cannot be loaded by node:test.
test('a service account is never listed in the member directory', () => {
  // It would otherwise qualify outright, since both its statuses are Active.
  assert.equal(isEligibleForMemberDirectory(SERVICE_ACCOUNT), false);
  assert.equal(isEligibleForMemberDirectory(MEMBER), true);
});
