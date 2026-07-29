import { describe, expect, it, vi } from 'vitest';

// configurationService.js talks to Firestore at module scope (doc(db, ...)
// refs built eagerly), so it needs firebase.js mocked even though these
// tests only exercise pure builder functions within it.
vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));

const { buildImportedExistingProfile, buildImportedNewProfile, buildInactivatedMembershipProfile } = await import(
  '../../src/services/configurationService.js'
);

describe('CSV import sets billingAddress.city from the roster Town column', () => {
  it('sets city on a brand-new profile created from the CSV', () => {
    const imported = { email: 'a@example.com', firstName: 'Nancy', lastName: 'Adams', name: 'Nancy Adams', phone: '', profileId: 'p1', status: 'Active', town: 'Vonore' };

    const profile = buildImportedNewProfile(imported, 'v1');

    expect(profile.billingAddress.city).toBe('Vonore');
    expect(profile.billingAddress.country).toBe('United States');
  });

  it('leaves city blank on a new profile when the CSV row has no town', () => {
    const imported = { email: 'a@example.com', firstName: 'Nancy', lastName: 'Adams', name: 'Nancy Adams', phone: '', profileId: 'p1', status: 'Active', town: '' };

    const profile = buildImportedNewProfile(imported, 'v1');

    expect(profile.billingAddress.city).toBe('');
  });

  it('syncs an existing profile\'s city to a newer town from the CSV', () => {
    const existing = { billingAddress: { city: 'Old Town', country: 'United States', postalCode: '37774', state: 'TN', street: '123 Main St' }, id: 'u1', role: 'General User', status: 'Active' };
    const imported = { email: 'a@example.com', name: 'Nancy Adams', status: 'Active', town: 'New Town' };

    const profile = buildImportedExistingProfile(existing, imported, 'email', 'v1');

    expect(profile.billingAddress.city).toBe('New Town');
    // Everything else on the address is untouched by the CSV import.
    expect(profile.billingAddress.street).toBe('123 Main St');
    expect(profile.billingAddress.state).toBe('TN');
    expect(profile.billingAddress.postalCode).toBe('37774');
  });

  it('preserves the existing city when the CSV row has a blank town', () => {
    const existing = { billingAddress: { city: 'Existing Town', country: 'United States', postalCode: '', state: '', street: '' }, id: 'u1', role: 'General User', status: 'Active' };
    const imported = { email: 'a@example.com', name: 'Nancy Adams', status: 'Active', town: '' };

    const profile = buildImportedExistingProfile(existing, imported, 'email', 'v1');

    expect(profile.billingAddress.city).toBe('Existing Town');
  });

  it('gives a profile with no prior billing address a fresh one from the town', () => {
    const existing = { id: 'u1', role: 'General User', status: 'Active' };
    const imported = { email: 'a@example.com', name: 'Nancy Adams', status: 'Active', town: 'Loudon' };

    const profile = buildImportedExistingProfile(existing, imported, 'email', 'v1');

    expect(profile.billingAddress.city).toBe('Loudon');
    expect(profile.billingAddress.country).toBe('United States');
  });
});

describe('Annual Refresh inactivation preserves town for profiles missing from this upload', () => {
  // buildInactivatedMembershipProfile is a full-document (merge: false)
  // replace for anyone in the DB but absent from an Annual Refresh CSV -
  // it must carry the existing billingAddress forward untouched, or a
  // roster that momentarily omits someone silently erases their town.
  it('carries the existing billingAddress.city forward unchanged', () => {
    const existing = {
      billingAddress: { city: 'Loudon', country: 'United States', postalCode: '37774', state: 'TN', street: '123 Main St' },
      id: 'u1',
      membershipStatus: 'Active',
      name: 'Nancy Adams',
      role: 'General User',
      status: 'Active'
    };

    const profile = buildInactivatedMembershipProfile(existing);

    expect(profile.billingAddress.city).toBe('Loudon');
    expect(profile.billingAddress.street).toBe('123 Main St');
    expect(profile.membershipStatus).toBe('Inactive');
  });

  it('still returns a well-formed empty billing address when the profile never had one', () => {
    const existing = { id: 'u1', membershipStatus: 'Active', name: 'Nancy Adams', role: 'General User', status: 'Active' };

    const profile = buildInactivatedMembershipProfile(existing);

    expect(profile.billingAddress.city).toBe('');
    expect(profile.billingAddress.country).toBe('United States');
  });
});
