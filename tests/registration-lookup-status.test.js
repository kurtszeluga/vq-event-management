import assert from 'node:assert/strict';
import test from 'node:test';
import { getVerifiedLookupStatus } from '../api/registration-lookup.js';

function context(overrides = {}) {
  return {
    allowNonMemberRegistration: false,
    hasExistingRegistration: false,
    membershipStatus: 'Inactive',
    profile: { id: 'user-1' },
    profileStatus: 'Active',
    requireMembershipCheck: true,
    ...overrides
  };
}

test('an inactive member is blocked when requireMembershipCheck is on (default)', () => {
  assert.equal(getVerifiedLookupStatus(context()), 'profile-membership-blocked');
});

test('an inactive member is blocked when requireMembershipCheck is omitted (fail closed)', () => {
  const contextWithoutFlag = context();
  delete contextWithoutFlag.requireMembershipCheck;
  assert.equal(getVerifiedLookupStatus(contextWithoutFlag), 'profile-membership-blocked');
});

test('an inactive member is no longer blocked when requireMembershipCheck is off', () => {
  assert.equal(
    getVerifiedLookupStatus(context({ requireMembershipCheck: false })),
    'profile-active'
  );
});

test('requireMembershipCheck off surfaces reactivation-available rather than active when the account itself is not active', () => {
  assert.equal(
    getVerifiedLookupStatus(context({ profileStatus: 'Archived', requireMembershipCheck: false })),
    'profile-reactivation-available'
  );
});

test('an active member is unaffected by requireMembershipCheck either way', () => {
  for (const requireMembershipCheck of [true, false]) {
    assert.equal(
      getVerifiedLookupStatus(context({ membershipStatus: 'Active', requireMembershipCheck })),
      'profile-active'
    );
  }
});

test('an event that already allows non-member registration is unaffected by requireMembershipCheck either way', () => {
  for (const requireMembershipCheck of [true, false]) {
    assert.equal(
      getVerifiedLookupStatus(context({ allowNonMemberRegistration: true, requireMembershipCheck })),
      'profile-active'
    );
  }
});

test('an existing registration still wins over everything else', () => {
  assert.equal(
    getVerifiedLookupStatus(context({ hasExistingRegistration: true, requireMembershipCheck: false })),
    'already-registered'
  );
});

test('no profile and no non-member allowance is membership-not-found regardless of requireMembershipCheck', () => {
  for (const requireMembershipCheck of [true, false]) {
    assert.equal(
      getVerifiedLookupStatus(context({ profile: null, requireMembershipCheck })),
      'membership-not-found'
    );
  }
});
