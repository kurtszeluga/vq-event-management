import { describe, expect, it, vi } from 'vitest';

// configurationService.js talks to Firestore at module scope (doc(db, ...)
// refs built eagerly), so it needs firebase.js mocked even though this test
// only exercises a pure function within it.
vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));

const { normalizeUserPermissions } = await import('../../src/services/configurationService.js');

describe('normalizeUserPermissions', () => {
  // This function backs archiveMembershipProfile/reactivateMembershipProfile,
  // both a full-document replace (merge: false) of users/{id} - not just the
  // CSV import path it looks like at a glance. Any permission key missing
  // here is a key that gets silently deleted from every admin's profile the
  // next time anyone archives or reactivates their membership status.
  it('carries registerOthers through when true', () => {
    expect(normalizeUserPermissions({ registerOthers: true }).registerOthers).toBe(true);
  });

  it('defaults registerOthers to false when absent', () => {
    expect(normalizeUserPermissions({}).registerOthers).toBe(false);
    expect(normalizeUserPermissions().registerOthers).toBe(false);
  });

  it('still normalizes every other existing permission key', () => {
    const result = normalizeUserPermissions({ manageEvents: true, registerOthers: true });

    expect(Object.keys(result).sort()).toEqual([
      'addUsers',
      'manageEvents',
      'manageMembershipStatus',
      'managePayments',
      'registerOthers',
      'viewRegistrations'
    ]);
    expect(result.manageEvents).toBe(true);
    expect(result.addUsers).toBe(false);
  });
});
