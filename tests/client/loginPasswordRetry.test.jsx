import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A wrong password should read as "try again", not as a nudge toward the
// verification code. The code is only worth offering once retrying has
// actually failed twice.

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

describe('wrong password lets you retry before the code is offered', () => {
  it('the first failure says to try again and does not mention the code', async () => {
    signInWithEmailAndPassword.mockRejectedValue(wrongPassword());
    const user = await renderLogin();

    await attemptSignIn(user);

    await waitFor(() => {
      expect(screen.getByText(/not correct\. Please try again\./)).toBeTruthy();
    });
    expect(screen.queryByText(/verification code/)).toBeNull();
  });

  it('leaves the password field usable so a second attempt is possible', async () => {
    signInWithEmailAndPassword.mockRejectedValue(wrongPassword());
    const user = await renderLogin();

    await attemptSignIn(user);

    const passwordField = screen.getByLabelText(/Password/);
    expect(passwordField.disabled).toBe(false);
    expect(screen.getByRole('button', { name: /^Sign in$/ }).disabled).toBe(false);
  });

  it('offers the verification code from the second failure', async () => {
    signInWithEmailAndPassword.mockRejectedValue(wrongPassword());
    const user = await renderLogin();

    await attemptSignIn(user);
    await attemptSignIn(user);

    await waitFor(() => {
      expect(screen.getByText(/sign in with a verification code/)).toBeTruthy();
    });
    expect(signInWithEmailAndPassword).toHaveBeenCalledTimes(2);
  });

  it('starts the count over when a different email is entered', async () => {
    signInWithEmailAndPassword.mockRejectedValue(wrongPassword());
    const user = await renderLogin();

    await attemptSignIn(user);
    await user.type(screen.getByLabelText(/Email/), '.uk');
    await attemptSignIn(user);

    await waitFor(() => {
      expect(screen.getByText(/not correct\. Please try again\./)).toBeTruthy();
    });
    expect(screen.queryByText(/verification code/)).toBeNull();
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
