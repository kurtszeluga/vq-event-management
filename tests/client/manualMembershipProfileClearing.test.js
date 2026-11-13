import { describe, expect, it, vi } from 'vitest';

// configurationService.js builds Firestore refs at module scope, so firebase.js
// has to be mocked even though these tests only exercise pure functions.
vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));

const { buildManualMembershipProfile } =
  await import('../../src/services/configurationService.js');

function existing(overrides = {}) {
  return {
    billingAddress: { city: 'Oak Park', country: 'United States' },
    email: 'member@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    name: 'Ada Lovelace',
    phone: '(555) 123-4567',
    status: 'Active',
    userId: 'user-1',
    ...overrides
  };
}

// The member form always spreads its whole state, so every key is present and
// an empty string means the admin cleared the field on purpose.
function submitted(overrides = {}) {
  return {
    email: 'member@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    name: 'Ada Lovelace',
    phone: '(555) 123-4567',
    status: 'Active',
    town: 'Oak Park',
    ...overrides
  };
}

describe('buildManualMembershipProfile clearing optional fields', () => {
  it('clears a phone number the admin emptied', () => {
    const result = buildManualMembershipProfile(
      submitted({ phone: '' }),
      existing(),
      'profile-1'
    );

    expect(result.phone).toBe('');
  });

  it('clears a town the admin emptied', () => {
    const result = buildManualMembershipProfile(
      submitted({ town: '' }),
      existing(),
      'profile-1'
    );

    expect(result.billingAddress.city).toBe('');
  });

  it('keeps the stored phone when the key was not submitted at all', () => {
    // A partial update must not wipe what it never mentioned - that is the
    // case the old `||` chain was protecting, and it still holds.
    const partial = submitted();
    delete partial.phone;

    const result = buildManualMembershipProfile(partial, existing(), 'profile-1');

    expect(result.phone).toBe('(555) 123-4567');
  });

  it('keeps the stored town when the key was not submitted at all', () => {
    const partial = submitted();
    delete partial.town;

    const result = buildManualMembershipProfile(partial, existing(), 'profile-1');

    expect(result.billingAddress.city).toBe('Oak Park');
  });

  it('still saves a changed phone number', () => {
    const result = buildManualMembershipProfile(
      submitted({ phone: '(555) 987-6543' }),
      existing(),
      'profile-1'
    );

    expect(result.phone).toBe('(555) 987-6543');
  });

  it('leaves the identity fields falling back, so a blank cannot orphan a profile', () => {
    // Deliberately unchanged behaviour: email is how a profile is matched at
    // registration and sign-in, and a nameless profile renders as nothing in
    // every list. Those keep their fallbacks.
    const result = buildManualMembershipProfile(
      submitted({ email: '', firstName: '', lastName: '', name: '' }),
      existing(),
      'profile-1'
    );

    expect(result.email).toBe('member@example.com');
    expect(result.name).toBe('Ada Lovelace');
  });
});
