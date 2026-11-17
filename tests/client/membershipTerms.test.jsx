import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));

const { needsMembershipTerms } = await import('../../src/utils/registrationEligibility.js');

describe('needsMembershipTerms', () => {
  const verified = { canShowRegistrantFields: true, confirmed: false, isStandaloneSignup: true };

  it('asks once the emailed code has been accepted', () => {
    expect(needsMembershipTerms(verified)).toBe(true);
  });

  it('does not ask before the address has been proved', () => {
    // canShowRegistrantFields is what turns true when the code is accepted.
    // Putting an agreement in front of someone who has only typed an address
    // asks them to commit to something before they have shown it is theirs,
    // and the rest of the form is not on screen yet either.
    expect(needsMembershipTerms({ ...verified, canShowRegistrantFields: false })).toBe(false);
  });

  it('does not ask again on the confirmation', () => {
    // The registration is already made and paid for; re-presenting the
    // agreement there would imply it had not been given.
    expect(needsMembershipTerms({ ...verified, confirmed: true })).toBe(false);
  });

  it('leaves every ordinary event registration alone', () => {
    // Classes and workshops are sold to people who are already members and
    // agreed to these terms when they joined. This is the membership signup's
    // own agreement, not a new gate on every registration in the app.
    expect(needsMembershipTerms({ ...verified, isStandaloneSignup: false })).toBe(false);
  });

  it('is false for anything missing rather than defaulting to asking', () => {
    expect(needsMembershipTerms({})).toBe(false);
  });
});
