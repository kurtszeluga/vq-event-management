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

  it('falls back to the emailed code when sign-in fails, and clears the password', async () => {
    lookupRegistrationEmail.mockResolvedValue({ profileExists: true, status: 'ok' });
    signInWithEmailAndPassword.mockRejectedValue(new Error('auth/wrong-password'));
    const { result } = setup();

    await act(async () => {
      await result.current.runEmailLookup('member@example.com');
    });

    act(() => {
      result.current.setAuthPassword('wrong-password');
    });

    await act(async () => {
      await result.current.handlePasswordSignIn();
    });

    expect(result.current.accountVerified).toBe(false);
    expect(result.current.authPassword).toBe('');
    expect(result.current.showEmailVerification).toBe(true);
    expect(result.current.emailVerificationError).toMatch(/could not sign you in/i);
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
