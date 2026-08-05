import { describe, expect, it, vi } from 'vitest';

// A membership CSV lists who is a member in good standing, not what anyone
// paid. The import used to record that as Paid with a zero amount, which the
// edit form then refused to re-save - so opening any imported profile and
// changing a phone number failed with "Enter the amount received for a
// membership cash or check payment", and there was no amount to enter.

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));
const { normalizeMembershipPayment } = await import('../../src/data/membershipPayments.js');
const { buildImportedNewProfile, buildImportedExistingProfile } =
  await import('../../src/services/configurationService.js');

function importedRow(overrides = {}) {
  return {
    blockingIssues: [],
    email: 'member@example.com',
    firstName: 'Ada',
    issues: [],
    lastName: 'Lovelace',
    phone: '(865) 555-1234',
    postalCode: '37774',
    profileId: 'ada-lovelace',
    status: 'Active',
    street: '12 Awohili Drive',
    town: 'Loudon',
    ...overrides
  };
}

describe('an imported membership payment', () => {
  it('saves without an amount', () => {
    // The regression. Previously this threw.
    expect(
      normalizeMembershipPayment({
        membershipPaymentAmount: '0',
        membershipPaymentMethod: '',
        membershipPaymentNote: 'Membership marked paid from CSV import.',
        membershipPaymentStatus: 'Imported'
      })
    ).toEqual({
      amount: 0,
      method: '',
      note: 'Membership marked paid from CSV import.',
      status: 'Imported'
    });
  });

  it('still refuses a real cash payment with no amount', () => {
    // Imported must not become a way to record a Paid entry with nothing in it.
    expect(() =>
      normalizeMembershipPayment({
        membershipPaymentAmount: '0',
        membershipPaymentMethod: 'Cash',
        membershipPaymentNote: '',
        membershipPaymentStatus: 'Paid'
      })
    ).toThrow(/amount received/i);
  });
});

describe('what the CSV import records', () => {
  it('marks a new active member Imported, not Paid', () => {
    const profile = buildImportedNewProfile(importedRow(), 'v1');

    expect(profile.membershipStatus).toBe('Active');
    expect(profile.membershipPaymentStatus).toBe('Imported');
  });

  it('leaves a row with blocking issues Pending', () => {
    // A row that could not be trusted must not read as a paid membership.
    const profile = buildImportedNewProfile(
      importedRow({ blockingIssues: ['Missing email'] }),
      'v1'
    );

    expect(profile.membershipStatus).toBe('Pending');
    expect(profile.membershipPaymentStatus).toBe('Pending');
  });

  it('marks a matched existing member Imported too', () => {
    const profile = buildImportedExistingProfile(
      { email: 'member@example.com', id: 'ada', membershipStatus: 'Pending', status: 'Active' },
      importedRow(),
      'email',
      'v1'
    );

    expect(profile.membershipPaymentStatus).toBe('Imported');
  });
});
