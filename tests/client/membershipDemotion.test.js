import { describe, expect, it, vi } from 'vitest';

// configurationService.js builds Firestore refs at module scope, so firebase.js
// has to be mocked even though these tests only exercise pure functions.
vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));

const { buildMembershipStatusProfile, getMembershipDemotion } =
  await import('../../src/services/configurationService.js');

function adminProfile(overrides = {}) {
  return {
    email: 'admin@example.com',
    membershipStatus: 'Active',
    name: 'Ada Lovelace',
    permissions: {
      addUsers: true,
      manageEvents: true,
      manageMembershipStatus: false,
      managePayments: false,
      manageWaitlist: true,
      registerOthers: false,
      viewRegistrations: true
    },
    role: 'Admin',
    status: 'Active',
    ...overrides
  };
}

describe('an admin whose membership stops being Active', () => {
  it.each(['Inactive', 'Archived', 'Pending', 'Unknown'])(
    'is demoted to General User when membership goes %s',
    (membershipStatus) => {
      const demotion = getMembershipDemotion(adminProfile(), membershipStatus);

      expect(demotion.role).toBe('General User');
      expect(Object.values(demotion.permissions).filter(Boolean)).toEqual([]);
    }
  );

  it('keeps its role and permissions while membership stays Active', () => {
    // Returns nothing at all, so an ordinary sync writes only membership fields
    // rather than rewriting role and permissions across the whole roster.
    expect(getMembershipDemotion(adminProfile(), 'Active')).toEqual({});
  });

  it('is demoted when the profile itself goes Inactive, membership aside', () => {
    const demotion = getMembershipDemotion(
      adminProfile({ status: 'Inactive' }),
      'Active'
    );

    expect(demotion.role).toBe('General User');
  });
});

describe('a Super User', () => {
  it('is never demoted by a membership change', () => {
    // Its authority does not come from membership, and demoting the only
    // account that can promote people would lock the guild out of its own admin.
    expect(
      getMembershipDemotion(adminProfile({ role: 'Super User' }), 'Archived')
    ).toEqual({});
  });
});

describe('a General User', () => {
  it('is left alone, so no needless role write goes out', () => {
    expect(
      getMembershipDemotion(adminProfile({ permissions: {}, role: 'General User' }), 'Archived')
    ).toEqual({});
  });
});

describe('archiving a membership directly', () => {
  it('writes the demoted role and an empty permission map', () => {
    const payload = buildMembershipStatusProfile(adminProfile(), 'Archived');

    expect(payload.membershipStatus).toBe('Archived');
    expect(payload.role).toBe('General User');
    expect(Object.values(payload.permissions).filter(Boolean)).toEqual([]);
  });

  it('leaves an admin in place when the membership is reactivated', () => {
    // Reactivating does not re-promote - the role was already written down to
    // General User, and restoring admin authority is a deliberate act.
    const payload = buildMembershipStatusProfile(
      adminProfile({ role: 'General User' }),
      'Active'
    );

    expect(payload.role).toBe('General User');
  });
});
