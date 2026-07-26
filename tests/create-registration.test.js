import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { canRegisterOthers, getProfileStatus, validateRegistrationEligibility } from '../api/create-registration.js';

const OPEN_EVENT = {
  eventType: 'Workshop',
  registrationMode: 'now',
  registrationOpenAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  registrationCloseAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  status: 'Published'
};

function assertRefused(fn, statusCode) {
  assert.throws(fn, (error) => {
    assert.equal(error.statusCode, statusCode);
    return true;
  });
}

function assertAllowed(fn) {
  assert.doesNotThrow(fn);
}

// requireMembershipCheck must only affect the membership-STATUS gate. These
// pin the two gates it must never touch, so a future edit can't accidentally
// widen its scope.
test('requireMembershipCheck does not affect the "no profile at all" gate', () => {
  assertRefused(
    () => validateRegistrationEligibility(OPEN_EVENT, {
      membershipStatus: 'Unknown',
      profile: null,
      profileStatus: '',
      requireMembershipCheck: false
    }),
    403
  );
});

test('requireMembershipCheck does not affect the reactivation-confirmation gate', () => {
  assertRefused(
    () => validateRegistrationEligibility(OPEN_EVENT, {
      membershipStatus: 'Active',
      profile: { id: 'user-1' },
      profileStatus: 'Archived',
      reactivateProfile: false,
      requireMembershipCheck: false
    }),
    400
  );
});

test('an active member always passes regardless of requireMembershipCheck', () => {
  for (const requireMembershipCheck of [true, false]) {
    assertAllowed(() => validateRegistrationEligibility(OPEN_EVENT, {
      membershipStatus: 'Active',
      profile: { id: 'user-1' },
      profileStatus: 'Active',
      requireMembershipCheck
    }));
  }
});

test('an inactive member is refused when requireMembershipCheck is on (default)', () => {
  assertRefused(
    () => validateRegistrationEligibility(OPEN_EVENT, {
      membershipStatus: 'Inactive',
      profile: { id: 'user-1' },
      profileStatus: 'Active',
      requireMembershipCheck: true
    }),
    403
  );
});

test('an inactive member is refused when requireMembershipCheck is omitted (fail closed)', () => {
  assertRefused(
    () => validateRegistrationEligibility(OPEN_EVENT, {
      membershipStatus: 'Inactive',
      profile: { id: 'user-1' },
      profileStatus: 'Active'
    }),
    403
  );
});

test('an inactive member is allowed when requireMembershipCheck is off - the actual testing use case', () => {
  assertAllowed(() => validateRegistrationEligibility(OPEN_EVENT, {
    membershipStatus: 'Inactive',
    profile: { id: 'user-1' },
    profileStatus: 'Active',
    requireMembershipCheck: false
  }));
});

test('an event that already allows non-member registration is unaffected by requireMembershipCheck either way', () => {
  const event = { ...OPEN_EVENT, allowNonMemberRegistration: true };

  for (const requireMembershipCheck of [true, false]) {
    assertAllowed(() => validateRegistrationEligibility(event, {
      membershipStatus: 'Inactive',
      profile: { id: 'user-1' },
      profileStatus: 'Active',
      requireMembershipCheck
    }));
  }
});

// canRegisterOthers reads only the caller's own stored profile - never the
// request body - so these fixtures represent that profile, not anything the
// admin's client could assert about itself.
describe('canRegisterOthers', () => {
  test('a Super User can register others regardless of their permissions object', () => {
    assert.equal(canRegisterOthers({ permissions: {}, role: 'Super User', status: 'Active' }), true);
  });

  test('an Active Admin with the permission can', () => {
    assert.equal(
      canRegisterOthers({ permissions: { registerOthers: true }, role: 'Admin', status: 'Active' }),
      true
    );
  });

  test('an Active Admin without the permission cannot', () => {
    assert.equal(
      canRegisterOthers({ permissions: { registerOthers: false }, role: 'Admin', status: 'Active' }),
      false
    );
    assert.equal(
      canRegisterOthers({ permissions: {}, role: 'Admin', status: 'Active' }),
      false
    );
  });

  test('an Inactive Admin cannot, even with the permission - the status gate wins', () => {
    assert.equal(
      canRegisterOthers({ permissions: { registerOthers: true }, role: 'Admin', status: 'Inactive' }),
      false
    );
  });

  test('a General User cannot, even if permissions somehow carries the key', () => {
    assert.equal(
      canRegisterOthers({ permissions: { registerOthers: true }, role: 'General User', status: 'Active' }),
      false
    );
  });

  test('a missing or empty profile cannot', () => {
    assert.equal(canRegisterOthers(null), false);
    assert.equal(canRegisterOthers({}), false);
  });
});

describe('getProfileStatus', () => {
  test('a Super User reads Active regardless of what their stored status field says', () => {
    assert.equal(getProfileStatus({ role: 'Super User' }), 'Active');
    assert.equal(getProfileStatus({ role: 'Super User', status: 'Inactive' }), 'Active');
    assert.equal(getProfileStatus({ role: 'Super User', status: '' }), 'Active');
  });

  test('an ordinary profile passes its stored status through', () => {
    assert.equal(getProfileStatus({ role: 'Admin', status: 'Active' }), 'Active');
    assert.equal(getProfileStatus({ role: 'General User', status: 'Inactive' }), 'Inactive');
  });

  test('an ordinary profile with no stored status reads Unknown, not Active', () => {
    assert.equal(getProfileStatus({ role: 'General User' }), 'Unknown');
  });

  test('archived fields win over a non-Super-User stored status', () => {
    assert.equal(getProfileStatus({ archivedDate: '2026-01-01', role: 'Admin', status: 'Active' }), 'Archived');
    assert.equal(getProfileStatus({ archivedBy: 'admin-1', role: 'Admin' }), 'Archived');
    assert.equal(getProfileStatus({ role: 'Admin', status: 'Archived' }), 'Archived');
  });

  test('a missing profile returns an empty string', () => {
    assert.equal(getProfileStatus(null), '');
  });
});
