import { describe, expect, it, vi } from 'vitest';

// Firebase is never touched by the function under test, but importing
// configurationService loads it - hence the stub and hence this living in
// vitest rather than beside the rest of the service-account tests.
vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));

const { getProfilesMissingFromImport } = await import(
  '../../src/services/configurationService.js'
);

// The Annual Refresh marks every profile missing from the CSV as Inactive,
// and an Inactive membership demotes an Admin to General User with its
// permissions cleared. A role mailbox is never in the roster, so without the
// skip below, programs@ and workshops@ would be shut down every January.

const SERVICE_ACCOUNT = {
  email: 'programs@villagequilters.com',
  id: 'svc-1',
  membershipStatus: 'Active',
  profileTags: ['serviceAccount'],
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

describe('the annual refresh sweep', () => {
  it('skips service accounts', () => {
    // Neither profile is in the import; only the member should be swept.
    const missing = getProfilesMissingFromImport([SERVICE_ACCOUNT, MEMBER], new Set());

    expect(missing.map((profile) => profile.id)).toEqual(['member-1']);
  });

  it('still deactivates an ordinary unmatched member', () => {
    expect(getProfilesMissingFromImport([MEMBER], new Set())).toHaveLength(1);
  });

  it('still skips Super Users and already-archived profiles', () => {
    const superUser = { ...MEMBER, id: 'su-1', role: 'Super User' };
    const archived = { ...MEMBER, id: 'arch-1', membershipStatus: 'Archived' };

    const missing = getProfilesMissingFromImport(
      [superUser, archived, MEMBER],
      new Set()
    );

    expect(missing.map((profile) => profile.id)).toEqual(['member-1']);
  });

  it('leaves a matched member alone', () => {
    expect(getProfilesMissingFromImport([MEMBER], new Set(['member-1']))).toHaveLength(0);
  });
});
