import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/registrationService.js', () => ({
  lookupRegistrationEmail: vi.fn(),
  startRegistrationEmailVerification: vi.fn(),
  verifyRegistrationEmailCode: vi.fn()
}));

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn()
}));

vi.mock('../../src/lib/firebase.js', () => ({
  auth: {}
}));

import { signInWithEmailAndPassword } from 'firebase/auth';
import {
  lookupRegistrationEmail,
  startRegistrationEmailVerification,
  verifyRegistrationEmailCode
} from '../../src/services/registrationService.js';
import { useIdentityVerification } from '../../src/hooks/useIdentityVerification.js';

function setup(overrides = {}) {
  const deps = {
    applyProfile: vi.fn(),
    currentUser: null,
    eventId: 'event-a',
    onBeforeLookup: vi.fn(),
    reset: vi.fn(),
    setFieldErrors: vi.fn(),
    setFormError: vi.fn(),
    userProfile: null,
    ...overrides
  };

  return { deps, ...renderHook(() => useIdentityVerification(deps)) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runEmailLookup', () => {
  it('rejects a malformed email without calling the API', async () => {
    const { deps, result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('not-an-email');
    });

    expect(lookupRegistrationEmail).not.toHaveBeenCalled();
    expect(deps.setFieldErrors).toHaveBeenLastCalledWith({ email: 'Valid email is required.' });
    expect(deps.setFormError).toHaveBeenLastCalledWith('Enter a valid email address first.');
    expect(result.current.lookupComplete).toBe(false);
  });

  it('normalizes the email before sending it', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: false, status: 'ok' });
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('  Member@Example.COM  ');
    });

    expect(lookupRegistrationEmail).toHaveBeenCalledWith('member@example.com', 'event-a');
    expect(result.current.email).toBe('member@example.com');
  });

  it('invalidates any in-progress payment hold before looking up', async () => {
    // A new lookup can change who is registering and what they owe, so the
    // caller's reservation/confirmation state must be cleared first.
    lookupRegistrationEmail.mockResolvedValue({ profileExists: false, status: 'ok' });
    const { deps, result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    expect(deps.onBeforeLookup).toHaveBeenCalled();
  });

  it('populates the registrant form when a profile is matched', async () => {
    const profile = { name: 'Ada Lovelace', status: 'Active' };
    lookupRegistrationEmail.mockResolvedValue({ profile, profileExists: true, verified: true });
    const { deps, result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com', { alreadyVerified: true });
    });

    expect(deps.applyProfile).toHaveBeenCalledWith(profile);
    expect(deps.reset).not.toHaveBeenCalled();
    expect(result.current.accountVerified).toBe(true);
    expect(result.current.lookupComplete).toBe(true);
  });

  it('does not mark an account verified when the server did not verify it', async () => {
    // alreadyVerified is the caller's optimistic hint; result.verified is the
    // server's answer and has to win, or an unverified person would be treated
    // as signed in.
    lookupRegistrationEmail.mockResolvedValue({
      profile: { status: 'Active' },
      profileExists: true,
      verified: false
    });
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com', { alreadyVerified: true });
    });

    expect(result.current.accountVerified).toBe(false);
  });

  it('never marks an account verified on an unprompted lookup', async () => {
    lookupRegistrationEmail.mockResolvedValue({
      profile: { status: 'Active' },
      profileExists: true,
      verified: true
    });
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    expect(result.current.accountVerified).toBe(false);
  });

  it('flags reactivation for a matched profile that is not active', async () => {
    lookupRegistrationEmail.mockResolvedValue({
      profile: { status: 'Inactive' },
      profileExists: true,
      verified: true
    });
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com', { alreadyVerified: true });
    });

    expect(result.current.reactivateProfile).toBe(true);
    expect(result.current.reactivationTermsAccepted).toBe(false);
  });

  it('clears the form and shows the code step when verification is required', async () => {
    lookupRegistrationEmail.mockResolvedValue({ status: 'email-verification-required' });
    const { deps, result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('newcomer@example.com');
    });

    expect(deps.reset).toHaveBeenCalled();
    expect(deps.applyProfile).not.toHaveBeenCalled();
    expect(result.current.showEmailVerification).toBe(true);
  });

  it('surfaces a lookup failure through the form error instead of throwing', async () => {
    lookupRegistrationEmail.mockRejectedValue(new Error('Email lookup failed.'));
    const { deps, result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    expect(deps.setFormError).toHaveBeenLastCalledWith('Email lookup failed.');
    expect(result.current.lookupLoading).toBe(false);
    expect(result.current.lookupComplete).toBe(false);
  });
});

describe('signed-in auto lookup', () => {
  it('looks up a signed-in user automatically, once', async () => {
    lookupRegistrationEmail.mockResolvedValue({
      profile: { status: 'Active' },
      profileExists: true,
      verified: true
    });

    const { result } = setup({
      currentUser: { uid: 'user-1' },
      userProfile: { email: 'member@example.com' }
    });

    await waitFor(() => expect(result.current.lookupComplete).toBe(true));

    expect(lookupRegistrationEmail).toHaveBeenCalledTimes(1);
    expect(lookupRegistrationEmail).toHaveBeenCalledWith('member@example.com', 'event-a');
    expect(result.current.accountVerified).toBe(true);
  });

  it('does not auto-look-up without an event or a signed-in profile', async () => {
    setup({ currentUser: { uid: 'user-1' }, eventId: '', userProfile: { email: 'm@example.com' } });
    setup({ currentUser: null, userProfile: { email: 'm@example.com' } });

    await act(async () => {});

    expect(lookupRegistrationEmail).not.toHaveBeenCalled();
  });
});

describe('handleEmailChange', () => {
  it('clears verification state so a changed email cannot reuse prior proof', async () => {
    // Without this, someone could verify one address, switch the field to
    // another, and carry the first address's verified state into submission.
    lookupRegistrationEmail.mockResolvedValue({
      profile: { status: 'Active' },
      profileExists: true,
      verified: true
    });
    const { deps, result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com', { alreadyVerified: true });
    });

    expect(result.current.accountVerified).toBe(true);

    act(() => {
      result.current.handleEmailChange('someone-else@example.com');
    });

    expect(result.current.email).toBe('someone-else@example.com');
    expect(result.current.accountVerified).toBe(false);
    expect(result.current.emailVerified).toBe(false);
    expect(result.current.lookupComplete).toBe(false);
    expect(result.current.lookup).toBe(null);
    expect(result.current.registrationVerificationToken).toBe('');
    expect(deps.reset).toHaveBeenCalled();
  });
});

describe('handlePasswordSignIn', () => {
  it('does nothing when no profile exists', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: false, status: 'ok' });
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    act(() => {
      result.current.setAuthPassword('hunter2');
    });

    await act(async () => {
      await result.current.handlePasswordSignIn();
    });

    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('requires a password before attempting sign-in', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status: 'ok' });
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    await act(async () => {
      await result.current.handlePasswordSignIn();
    });

    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
    expect(result.current.authError).toBe('Enter your password to continue.');
  });

  async function failSignIn(result, password = 'wrong-password') {
    act(() => {
      result.current.setAuthPassword(password);
    });

    await act(async () => {
      await result.current.handlePasswordSignIn();
    });
  }

  it('keeps the password step on a first failure instead of forcing the code', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status: 'ok' });
    signInWithEmailAndPassword.mockRejectedValue(new Error('auth/wrong-password'));
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    await failSignIn(result);

    expect(result.current.accountVerified).toBe(false);
    expect(result.current.authPassword).toBe('');
    expect(result.current.showEmailVerification).toBe(false);
    // Points at the code option without taking the password step away.
    expect(result.current.authError).toBe(
      'That password is not correct. Please try again or use the Email Me A Verification Code option below.'
    );
  });

  it('falls back to the emailed code on the second failure, and clears the password', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status: 'ok' });
    signInWithEmailAndPassword.mockRejectedValue(new Error('auth/wrong-password'));
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    await failSignIn(result);
    await failSignIn(result, 'wrong-again');

    expect(result.current.accountVerified).toBe(false);
    expect(result.current.authPassword).toBe('');
    expect(result.current.showEmailVerification).toBe(true);
    expect(result.current.emailVerificationError).toMatch(/could not sign you in/i);
  });

  it('starts the attempt count over when the email is changed', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status: 'ok' });
    signInWithEmailAndPassword.mockRejectedValue(new Error('auth/wrong-password'));
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    await failSignIn(result);

    act(() => {
      result.current.handleEmailChange('someone-else@example.com');
    });

    await act(async () => {
      await result.current.runEmailLookup('someone-else@example.com');
    });

    await failSignIn(result);

    expect(result.current.showEmailVerification).toBe(false);
    expect(result.current.authError).toMatch(/not correct/i);
  });

  it('re-runs the lookup as verified after a successful sign-in', async () => {
    lookupRegistrationEmail.mockResolvedValue({
      profile: { status: 'Active' },
      profileExists: true,
      verified: true
    });
    signInWithEmailAndPassword.mockResolvedValue({ user: { uid: 'user-1' } });
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    act(() => {
      result.current.setAuthPassword('correct-password');
    });

    await act(async () => {
      await result.current.handlePasswordSignIn();
    });

    expect(signInWithEmailAndPassword).toHaveBeenCalled();
    expect(result.current.accountVerified).toBe(true);
  });
});

describe('email code verification', () => {
  it('refuses to verify a code that is not six digits', async () => {
    startRegistrationEmailVerification.mockResolvedValue({ challengeId: 'challenge-1' });
    const { result } = setup();

    await act(async () => {
      await result.current.handleStartEmailVerification();
    });

    act(() => {
      result.current.setEmailVerificationCode('123');
    });

    await act(async () => {
      await result.current.handleVerifyEmailCode();
    });

    expect(verifyRegistrationEmailCode).not.toHaveBeenCalled();
    expect(result.current.emailVerificationError).toMatch(/six-digit/i);
  });

  it('refuses to verify without a challenge id', async () => {
    const { result } = setup();

    act(() => {
      result.current.setEmailVerificationCode('123456');
    });

    await act(async () => {
      await result.current.handleVerifyEmailCode();
    });

    expect(verifyRegistrationEmailCode).not.toHaveBeenCalled();
  });

  it('stores the registration token and marks the email verified on success', async () => {
    startRegistrationEmailVerification.mockResolvedValue({ challengeId: 'challenge-1' });
    verifyRegistrationEmailCode.mockResolvedValue({
      profile: { status: 'Active' },
      registrationToken: 'token-abc'
    });
    const { deps, result } = setup();

    await act(async () => {
      await result.current.handleStartEmailVerification();
    });

    act(() => {
      result.current.setEmailVerificationCode('123456');
    });

    await act(async () => {
      await result.current.handleVerifyEmailCode();
    });

    expect(verifyRegistrationEmailCode).toHaveBeenCalledWith({
      challengeId: 'challenge-1',
      code: '123456',
      email: '',
      eventId: 'event-a'
    });
    expect(result.current.emailVerified).toBe(true);
    expect(result.current.accountVerified).toBe(false);
    expect(result.current.registrationVerificationToken).toBe('token-abc');
    expect(result.current.showEmailVerification).toBe(false);
    expect(deps.applyProfile).toHaveBeenCalled();
  });

  it('clears the registration token when verification fails', async () => {
    // A stale token must not survive a failed attempt, or a rejected code
    // could still carry proof forward into submission.
    startRegistrationEmailVerification.mockResolvedValue({ challengeId: 'challenge-1' });
    verifyRegistrationEmailCode.mockRejectedValue(new Error('That code is incorrect.'));
    const { result } = setup();

    await act(async () => {
      await result.current.handleStartEmailVerification();
    });

    act(() => {
      result.current.setEmailVerificationCode('123456');
    });

    await act(async () => {
      await result.current.handleVerifyEmailCode();
    });

    expect(result.current.emailVerified).toBe(false);
    expect(result.current.registrationVerificationToken).toBe('');
    expect(result.current.emailVerificationError).toBe('That code is incorrect.');
  });

  it('strips non-digits from the entered code', async () => {
    startRegistrationEmailVerification.mockResolvedValue({ challengeId: 'challenge-1' });
    verifyRegistrationEmailCode.mockResolvedValue({ registrationToken: 'token-abc' });
    const { result } = setup();

    await act(async () => {
      await result.current.handleStartEmailVerification();
    });

    act(() => {
      result.current.setEmailVerificationCode('12-34 56');
    });

    await act(async () => {
      await result.current.handleVerifyEmailCode();
    });

    expect(verifyRegistrationEmailCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: '123456' })
    );
  });

  it('surfaces a send failure without showing the code input', async () => {
    startRegistrationEmailVerification.mockRejectedValue(new Error('Too many requests.'));
    const { result } = setup();

    await act(async () => {
      await result.current.handleStartEmailVerification();
    });

    expect(result.current.emailVerificationChallengeId).toBe('');
    expect(result.current.emailVerificationError).toBe('Too many requests.');
    expect(result.current.emailVerificationSending).toBe(false);
  });
});

// The password-setup token rides along with code verification so the register
// page can offer to set a password afterwards. It is deliberately held rather
// than used at verification time - signing in there would move the gates the
// rest of the registration is standing on.
describe('password setup token', () => {
  async function verifyWith(response) {
    startRegistrationEmailVerification.mockResolvedValue({ challengeId: 'challenge-1' });
    verifyRegistrationEmailCode.mockResolvedValue(response);
    const { result } = setup();

    await act(async () => {
      await result.current.handleStartEmailVerification();
    });
    act(() => {
      result.current.setEmailVerificationCode('123456');
    });
    await act(async () => {
      await result.current.handleVerifyEmailCode();
    });

    return result;
  }

  it('is kept when the endpoint returns one', async () => {
    const result = await verifyWith({
      passwordSetupToken: 'custom-token-xyz',
      profile: { status: 'Active' },
      registrationToken: 'token-abc'
    });

    expect(result.current.passwordSetupToken).toBe('custom-token-xyz');
    expect(result.current.emailVerified).toBe(true);
  });

  it('is empty when the endpoint could not mint one', async () => {
    // Minting is non-fatal on the server - a member must still be able to
    // register when the optional extra could not be prepared.
    const result = await verifyWith({
      profile: { status: 'Active' },
      registrationToken: 'token-abc'
    });

    expect(result.current.passwordSetupToken).toBe('');
    expect(result.current.emailVerified).toBe(true);
  });

  it('does not sign anyone in at verification time', async () => {
    await verifyWith({
      passwordSetupToken: 'custom-token-xyz',
      profile: { status: 'Active' },
      registrationToken: 'token-abc'
    });

    expect(signInWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it('is cleared when the code is rejected', async () => {
    startRegistrationEmailVerification.mockResolvedValue({ challengeId: 'challenge-1' });
    verifyRegistrationEmailCode.mockResolvedValue({
      passwordSetupToken: 'custom-token-xyz',
      registrationToken: 'token-abc'
    });
    const { result } = setup();

    await act(async () => {
      await result.current.handleStartEmailVerification();
    });
    act(() => {
      result.current.setEmailVerificationCode('123456');
    });
    await act(async () => {
      await result.current.handleVerifyEmailCode();
    });

    expect(result.current.passwordSetupToken).toBe('custom-token-xyz');

    verifyRegistrationEmailCode.mockRejectedValue(new Error('That code is incorrect.'));
    act(() => {
      result.current.setEmailVerificationCode('654321');
    });
    await act(async () => {
      await result.current.handleVerifyEmailCode();
    });

    expect(result.current.passwordSetupToken).toBe('');
    expect(result.current.emailVerified).toBe(false);
  });
});

describe('the signed-in auto lookup', () => {
  const signedIn = {
    currentUser: { uid: 'user-1' },
    userProfile: { email: 'vqhosting@villagequilters.com', userId: 'user-1' }
  };

  it('fills the email box from the signed-in account on arrival', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status: 'ok', verified: true });
    const { result } = setup(signedIn);

    await waitFor(() => expect(result.current.email).toBe('vqhosting@villagequilters.com'));
    expect(lookupRegistrationEmail).toHaveBeenCalledWith('vqhosting@villagequilters.com', 'event-a');
  });

  // The bug this guards: handleEmailChange clears lookupComplete, which used
  // to re-arm the auto lookup. Typing a different address put the signed-in
  // one straight back - and because the auto lookup runs alreadyVerified, the
  // signed-in profile came with it, so the registration would have been
  // created for the wrong person entirely.
  it('does not overwrite a different email the registrant types', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status: 'ok', verified: true });
    const { result } = setup(signedIn);

    await waitFor(() => expect(result.current.email).toBe('vqhosting@villagequilters.com'));

    act(() => {
      result.current.handleEmailChange('kurtszeluga@hotmail.com');
    });

    expect(result.current.email).toBe('kurtszeluga@hotmail.com');

    // The re-arm was asynchronous, so a synchronous assertion alone would have
    // passed against the broken version too.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(result.current.email).toBe('kurtszeluga@hotmail.com');
    expect(lookupRegistrationEmail).toHaveBeenCalledTimes(1);
  });

  it('runs once, not once per keystroke in the email box', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status: 'ok', verified: true });
    const { result } = setup(signedIn);

    await waitFor(() => expect(lookupRegistrationEmail).toHaveBeenCalledTimes(1));

    for (const value of ['k', 'ku', 'kur', 'kurt@example.com']) {
      act(() => {
        result.current.handleEmailChange(value);
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lookupRegistrationEmail).toHaveBeenCalledTimes(1);
    expect(result.current.email).toBe('kurt@example.com');
  });

  it('does nothing at all when nobody is signed in', async () => {
    const { result } = setup();

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(lookupRegistrationEmail).not.toHaveBeenCalled();
    expect(result.current.email).toBe('');
  });
});

describe('codeOnlyVerification, the temporary membership signup', () => {
  it('sends a code instead of asking for a password, even when an account exists', async () => {
    // The reported behaviour: entering an email on the membership signup
    // produced "Account Found - enter your password". That signup exists to
    // take a payment, not to get someone into an account.
    lookupRegistrationEmail.mockResolvedValue({
      profile: { email: 'ada@example.com', firstName: 'Ada', status: 'Active' },
      profileExists: true,
      status: 'ok',
      verified: true
    });
    startRegistrationEmailVerification.mockResolvedValue({ challengeId: 'chal-1' });

    const { deps, result } = setup({ codeOnlyVerification: true });

    await act(async () => {
      await result.current.runEmailLookup('ada@example.com');
    });

    expect(startRegistrationEmailVerification).toHaveBeenCalledWith('ada@example.com', 'event-a');
    expect(result.current.showEmailVerification).toBe(true);
    // Never treated as signed in, so getNeedsAccountPassword cannot ask.
    expect(result.current.accountVerified).toBe(false);
    // The existing profile is NOT applied here - it is applied after the code
    // is accepted, which is the right order and also means the page does not
    // reveal that the address has an account.
    expect(deps.applyProfile).not.toHaveBeenCalled();
    expect(deps.reset).toHaveBeenCalled();
  });

  it('names the address in the message so it is obvious where to look', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: false, status: 'ok' });
    startRegistrationEmailVerification.mockResolvedValue({ challengeId: 'chal-2' });

    const { result } = setup({ codeOnlyVerification: true });

    await act(async () => {
      await result.current.runEmailLookup('New.Member@Example.com');
    });

    expect(result.current.emailVerificationMessage).toContain('new.member@example.com');
    expect(result.current.emailVerificationChallengeId).toBe('chal-2');
  });

  it('surfaces a failure to send rather than sitting silent', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: false, status: 'ok' });
    startRegistrationEmailVerification.mockRejectedValue(new Error('Email service is down.'));

    const { result } = setup({ codeOnlyVerification: true });

    await act(async () => {
      await result.current.runEmailLookup('ada@example.com');
    });

    expect(result.current.emailVerificationError).toBe('Email service is down.');
  });

  it('leaves every other registration on the account path', async () => {
    lookupRegistrationEmail.mockResolvedValue({
      profile: { email: 'ada@example.com', status: 'Active' },
      profileExists: true,
      status: 'ok'
    });

    const { deps, result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('ada@example.com');
    });

    expect(startRegistrationEmailVerification).not.toHaveBeenCalled();
    expect(result.current.showEmailVerification).toBe(false);
    expect(deps.applyProfile).toHaveBeenCalled();
  });
});

describe('a signed-in browser on a code-only signup', () => {
  const signedIn = {
    codeOnlyVerification: true,
    currentUser: { uid: 'user-1' },
    userProfile: { email: 'webmaster@villagequilters.com', userId: 'user-1' }
  };

  it('sends no code, and fills in nothing, just for opening the link', async () => {
    // Reported from a fresh Firefox window: the guild account was still
    // signed in, so opening the dues link announced "this registration will
    // be for webmaster@villagequilters.com" and emailed a verification code
    // before anything had been typed or pressed.
    //
    // The auto-lookup exists to spare a signed-in member retyping their
    // address. On this path the lookup also SENDS AN EMAIL, and a
    // convenience that posts mail on page load is not a convenience.
    lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status: 'ok', verified: true });
    startRegistrationEmailVerification.mockResolvedValue({ challengeId: 'chal-1' });

    const { result } = setup(signedIn);

    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(startRegistrationEmailVerification).not.toHaveBeenCalled();
    expect(lookupRegistrationEmail).not.toHaveBeenCalled();
    expect(result.current.email).toBe('');
    expect(result.current.showEmailVerification).toBe(false);
  });

  it('still prefills a signed-in member on an ordinary event registration', async () => {
    // The convenience is not removed, only kept off the path where it would
    // send mail unasked.
    lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status: 'ok', verified: true });

    const { result } = setup({ ...signedIn, codeOnlyVerification: false });

    await waitFor(() => expect(result.current.email).toBe('webmaster@villagequilters.com'));
    expect(startRegistrationEmailVerification).not.toHaveBeenCalled();
  });
});

describe('a refusal on a code-only signup', () => {
  const codeOnly = { codeOnlyVerification: true };

  it('stops at the lookup instead of emailing a code first', async () => {
    // Without this, someone already signed up waits for an email, fetches the
    // code, types it in, and only then learns they could not have continued.
    // The lookup knew from the start.
    lookupRegistrationEmail.mockResolvedValue({
      profileExists: true,
      status: 'already-registered'
    });

    const { result } = setup(codeOnly);

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    expect(startRegistrationEmailVerification).not.toHaveBeenCalled();
    expect(result.current.showEmailVerification).toBe(false);
    // lookupComplete with a blocked status is what renders the reason and
    // brings Submit back, so another address can be tried.
    expect(result.current.lookupComplete).toBe(true);
    expect(result.current.lookup.status).toBe('already-registered');
  });

  it('stops for the other refusals too, not just a duplicate', async () => {
    for (const status of ['membership-blocked', 'membership-not-found', 'profile-membership-blocked']) {
      vi.clearAllMocks();
      lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status });

      const { result } = setup(codeOnly);

      await act(async () => {
        await result.current.runEmailLookup('member@example.com');
      });

      expect(startRegistrationEmailVerification, status).not.toHaveBeenCalled();
    }
  });

  it('still sends a code when the lookup raises nothing', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: false, status: 'ok' });
    startRegistrationEmailVerification.mockResolvedValue({ challengeId: 'chal-1' });

    const { result } = setup(codeOnly);

    await act(async () => {
      await result.current.runEmailLookup('new@example.com');
    });

    expect(startRegistrationEmailVerification).toHaveBeenCalledWith('new@example.com', 'event-a');
    expect(result.current.showEmailVerification).toBe(true);
  });
});
