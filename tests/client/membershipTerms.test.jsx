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

describe('the registrant fields on a standalone signup', () => {
  // Reported: after entering the email and the code, the form had no name,
  // phone or email fields at all.
  //
  // Those fields are hidden for anyone with a matched profile, because a
  // matched profile is normally displayed in LookupResult with an Edit
  // button - and LookupResult is hidden on a standalone signup, since it
  // reports account details this flow has no business showing. The two
  // decisions together left a returning member with nothing to fill in and
  // nothing explaining why.
  //
  // Asserted on the real condition rather than through a render, because the
  // bug was in the condition: a matched profile must NOT hide the fields when
  // there is no card to show them in.
  it('shows them even when a profile matched, because nothing else would', async () => {
    const { showsRegistrantFields: fieldsVisible } =
      await import('../../src/utils/registrationEligibility.js');

    // The reported case.
    expect(fieldsVisible({
      matchedProfile: { email: 'member@example.com' },
      needsProfileEdits: false,
      isStandaloneSignup: true
    })).toBe(true);

    // A brand-new address has always shown them.
    expect(fieldsVisible({
      matchedProfile: null,
      needsProfileEdits: false,
      isStandaloneSignup: true
    })).toBe(true);

    // An ordinary event registration is unchanged: a matched profile is shown
    // in the lookup card there, with an Edit button, so the grid stays shut
    // until it is asked for.
    expect(fieldsVisible({
      matchedProfile: { email: 'member@example.com' },
      needsProfileEdits: false,
      isStandaloneSignup: false
    })).toBe(false);

    expect(fieldsVisible({
      matchedProfile: { email: 'member@example.com' },
      needsProfileEdits: true,
      isStandaloneSignup: false
    })).toBe(true);
  });
});
