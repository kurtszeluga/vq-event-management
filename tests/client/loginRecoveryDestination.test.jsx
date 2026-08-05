import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Where account recovery drops someone after their code is accepted.
//
// An account with no password gets the setup mode, which says the account has
// none and signs the session back out if they leave without saving one.
// Otherwise recovery is an ordinary reset and the session stays either way.
// Getting this backwards either strands a member in a session they can never
// recreate, or signs out someone who was only changing a password they had.

const navigate = vi.fn();

vi.mock('firebase/auth', () => ({
  signInWithCustomToken: vi.fn(() => Promise.resolve()),
  signInWithEmailAndPassword: vi.fn()
}));
vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));
vi.mock('../../src/services/accountRecoveryService.js', () => ({
  startAccountRecovery: vi.fn(() => Promise.resolve({ challengeId: 'challenge-1' })),
  verifyAccountRecoveryCode: vi.fn()
}));
vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => ({ currentUser: null, firebaseConfigured: true, loading: false })
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal()),
  useNavigate: () => navigate
}));

import { startAccountRecovery, verifyAccountRecoveryCode } from '../../src/services/accountRecoveryService.js';

const { default: LoginPage } = await import('../../src/pages/LoginPage.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  startAccountRecovery.mockResolvedValue({ challengeId: 'challenge-1' });
});

afterEach(cleanup);

async function recoverWith(verifyResult) {
  verifyAccountRecoveryCode.mockResolvedValue({ customToken: 'token-1', ...verifyResult });

  const user = userEvent.setup();

  render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );

  await user.click(screen.getByRole('button', { name: /forgot password/i }));
  await user.type(screen.getByLabelText(/email or phone/i), 'member@example.com');
  await user.click(screen.getByRole('button', { name: /send.*code/i }));
  await waitFor(() => expect(startAccountRecovery).toHaveBeenCalled());
  await user.type(screen.getByLabelText(/verification code/i), '123456');
  await user.click(screen.getByRole('button', { name: /verify/i }));
  await waitFor(() => expect(navigate).toHaveBeenCalled());

  return navigate.mock.calls[0][0];
}

describe('after an accepted recovery code', () => {
  it('sends a passwordless account into setup mode', async () => {
    expect(await recoverWith({ hasPassword: false })).toBe('/profile?passwordSetup=1');
  });

  it('sends an account that has a password to the ordinary reset', async () => {
    expect(await recoverWith({ hasPassword: true })).toBe('/profile?passwordReset=1');
  });

  it('treats a missing answer as an ordinary reset', async () => {
    // The server defaults hasPassword to true when the check could not be made,
    // and an older deployment omits the field entirely. Both must leave the
    // member signed in rather than signing them out over an unknown.
    expect(await recoverWith({})).toBe('/profile?passwordReset=1');
  });
});
