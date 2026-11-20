import { describe, expect, it } from 'vitest';
import { MEMBERSHIP_PAYMENT_STATUS_OPTIONS } from '../../src/services/configurationService.js';

// Payment status is now editable from System Config > Membership Profiles,
// which previously carried it through untouched from whatever was stored.
// The carry-through still matters: the CSV import writes 'Imported' here, so
// a save that does not send the field must not quietly reset it to Pending.

describe('the membership payment statuses', () => {
  it('are exactly the five the Firestore rules accept', () => {
    // firestore.rules validates membershipPaymentStatus against this list; a
    // sixth option in the dropdown would make the profile unwritable, and the
    // admin would see a bare permission denial.
    expect([...MEMBERSHIP_PAYMENT_STATUS_OPTIONS].sort()).toEqual([
      'Imported',
      'Paid',
      'Pending',
      'Refunded',
      'Waived'
    ]);
  });

  it('includes Imported, which only the CSV import sets', () => {
    // Listed so an admin can see it on a profile and change it deliberately,
    // rather than it being a value the form cannot represent.
    expect(MEMBERSHIP_PAYMENT_STATUS_OPTIONS).toContain('Imported');
  });
});
