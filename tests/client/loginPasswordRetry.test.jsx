import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The verification code is offered from the FIRST failure. That reverses the
// earlier "let a first wrong password just be a retry" behaviour, and the
// reason it changed is the membership CSV import: 250-odd profiles have never
// had a password, so their first attempt is certain to fail and telling them
// to retype cannot help. Firebase's email enumeration protection returns
// auth/invalid-credential for both an unknown account and a wrong password,
// so the page cannot tell a first-time member from a typo and the wording has
// to serve both.
//
// The retry itself is still unimpeded - the field stays usable and the count
// still resets per email; only the wording changed.

const signInWithEmailAndPassword = vi.fn();

vi.mock('firebase/auth', () => ({
  signInWithCustomToken: vi.fn(),
  signInWithEmailAndPassword: (...args) => signInWithEmailAndPassword(...args)
}));
vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));
vi.mock('../../src/services/accountRecoveryService.js', () => ({
  startAccountRecovery: vi.fn(),
  verifyAccountRecoveryCode: vi.fn()
}));
vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => ({ currentUser: null, firebaseConfigured: true, loading: false })
}));

const { default: LoginPage } = await import('../../src/pages/LoginPage.jsx');

function wrongPassword() {
  return Object.assign(new Error('bad credential'), { code: 'auth/invalid-credential' });
}

async function attemptSignIn(user) {
  await user.click(screen.getByRole('button', { name: /^Sign in$/ }));
}

beforeEach(() => {
  signInWithEmailAndPassword.mockReset();
});

afterEach(cleanup);

async function renderLogin() {
  const user = userEvent.setup();
  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
  await user.type(screen.getByLabelText(/Email/), 'member@example.com');
  await user.type(screen.getByLabelText(/Password/), 'wrong-password');
  return user;
}

describe('a failed password points at the verification code straight away', () => {
  it('the first failure already offers the code', async () => {
    signInWithEmailAndPassword.mockRejectedValue(wrongPassword());
    const user = await renderLogin();

    await attemptSignIn(user);

    await waitFor(() => {
      expect(screen.getByText(/was not accepted/)).toBeTruthy();
    });
    expect(screen.getByText(/sign in with a verification code/)).toBeTruthy();
  });

  it('leaves the password field usable so a second attempt is possible', async () => {
    signInWithEmailAndPassword.mockRejectedValue(wrongPassword());
    const user = await renderLogin();

    await attemptSignIn(user);

    const passwordField = screen.getByLabelText(/Password/);
    expect(passwordField.disabled).toBe(false);
    expect(screen.getByRole('button', { name: /^Sign in$/ }).disabled).toBe(false);
  });

  it('keeps offering the code on a repeated failure, with different wording', async () => {
    signInWithEmailAndPassword.mockRejectedValue(wrongPassword());
    const user = await renderLogin();

    await attemptSignIn(user);
    await attemptSignIn(user);

    await waitFor(() => {
      expect(screen.getByText(/That still did not work/)).toBeTruthy();
    });
    expect(screen.getByText(/sign in with a verification code/)).toBeTruthy();
    expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(2);
  });

  it('starts the count over when a different email is entered', async () => {
    signInWithEmailAndPassword.mockRejectedValue(wrongPassword());
    const user = await renderLogin();

    await attemptSignIn(user);
    await user.type(screen.getByLabelText(/Email/), '.uk');
    await attemptSignIn(user);

    // Back to the first-failure wording, not the repeated-failure one.
    await waitFor(() => {
      expect(screen.getByText(/was not accepted/)).toBeTruthy();
    });
    expect(screen.queryByText(/That still did not work/)).toBeNull();
  });

  it('does not count a network failure toward the code prompt', async () => {
    signInWithEmailAndPassword.mockRejectedValue(
      Object.assign(new Error('offline'), { code: 'auth/network-request-failed' })
    );
    const user = await renderLogin();

    await attemptSignIn(user);
    await attemptSignIn(user);

    await waitFor(() => {
      expect(screen.getByText(/Could not connect/)).toBeTruthy();
    });
    expect(screen.queryByText(/verification code/)).toBeNull();
  });
});
