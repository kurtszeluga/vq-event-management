import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The profile page in passwordSetup mode - where a registrant who verified by
// emailed code lands. The sign-in behind them is provisional: it exists only so
// a password can be set, and the account has none until one is saved. Leaving
// without saving has to take the session with it, or someone who backs out here
// is silently signed in on a passwordless account, which is exactly what was
// reported.
const authState = {
  currentUser: { email: 'member@example.com', uid: 'user-1' },
  loading: false,
  profileError: '',
  userProfile: {
    billingAddress: {},
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '(352) 653-8188',
    role: 'Member'
  }
};

let searchParams = new URLSearchParams('passwordSetup=1');

vi.mock('../../src/context/useAuth.js', () => ({ useAuth: () => authState }));
vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));
vi.mock('firebase/auth', () => ({
  signOut: vi.fn(() => Promise.resolve()),
  updatePassword: vi.fn(() => Promise.resolve()),
  updateProfile: vi.fn()
}));
vi.mock('../../src/services/registrationService.js', () => ({
  subscribeToMembershipPayments: (userId, onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(() => ({
    update: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    commit: vi.fn(() => Promise.resolve())
  }))
}));
vi.mock('../../src/services/memberDirectoryProfile.js', () => ({
  applyMemberDirectorySync: vi.fn()
}));
vi.mock('../../src/components/PageHeader.jsx', () => ({ default: () => null }));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
  Navigate: () => null,
  useSearchParams: () => [searchParams]
}));

import { signOut, updatePassword } from 'firebase/auth';

const { default: ProfilePage } = await import('../../src/pages/ProfilePage.jsx');

beforeEach(() => {
  vi.clearAllMocks();
  searchParams = new URLSearchParams('passwordSetup=1');
});

afterEach(cleanup);

async function setPassword(user, value = 'sturdy-passphrase') {
  await user.type(screen.getByLabelText(/^New Password/i), value);
  await user.type(screen.getByLabelText(/Confirm New Password/i), value);
  await user.click(screen.getByRole('button', { name: /set password/i }));
}

describe('leaving password setup without saving', () => {
  it('signs the provisional session out', async () => {
    const { unmount } = render(<ProfilePage />);

    unmount();

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });

  it('offers a way out that says what it is', () => {
    render(<ProfilePage />);

    expect(screen.getByRole('link', { name: /skip for now/i })).toBeTruthy();
    expect(screen.getByText(/still has no password and you are not signed in/i)).toBeTruthy();
  });
});

describe('saving a password during setup', () => {
  it('keeps the session', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<ProfilePage />);

    await setPassword(user);
    await waitFor(() => expect(updatePassword).toHaveBeenCalledTimes(1));

    unmount();

    expect(signOut).not.toHaveBeenCalled();
  });

  it('confirms the account is now usable', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await setPassword(user);

    expect(await screen.findByText(/password set\. you are signed in/i)).toBeTruthy();
  });

  it('keeps the session even if the member never leaves the page', async () => {
    // The saved flag is set before any state update, so the unmount cleanup
    // cannot race a re-render and sign out a session that now has a password.
    const user = userEvent.setup();
    const { unmount } = render(<ProfilePage />);

    await setPassword(user);
    await waitFor(() => expect(screen.queryByRole('link', { name: /skip for now/i })).toBeNull());

    unmount();

    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('a failed password save during setup', () => {
  it('still signs out on the way out, because no password was set', async () => {
    updatePassword.mockRejectedValueOnce(new Error('auth/weak-password'));
    const user = userEvent.setup();
    const { unmount } = render(<ProfilePage />);

    await setPassword(user);
    await waitFor(() => expect(updatePassword).toHaveBeenCalled());

    unmount();

    await waitFor(() => expect(signOut).toHaveBeenCalledTimes(1));
  });
});

describe('the ordinary profile page', () => {
  it('does not sign anyone out when it is not a setup arrival', async () => {
    searchParams = new URLSearchParams();
    const { unmount } = render(<ProfilePage />);

    unmount();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(signOut).not.toHaveBeenCalled();
  });
});

// Recovering an account that DOES have a password lands on passwordReset=1.
// The member is signed in on a password they could not remember, and the only
// thing telling them to replace it was a banner below the profile details.
describe('arriving from account recovery', () => {
  it('interrupts with the offer to update the password', () => {
    searchParams = new URLSearchParams('passwordReset=1');
    render(<ProfilePage />);

    expect(screen.getByRole('heading', { name: /update your password\?/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /update password/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /not now/i })).toBeTruthy();
  });

  it('puts the member on the password field when they accept', async () => {
    searchParams = new URLSearchParams('passwordReset=1');
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: /update password/i }));

    expect(screen.queryByRole('heading', { name: /update your password\?/i })).toBeNull();
    expect(document.activeElement).toBe(screen.getByLabelText(/^New Password/i));
  });

  it('closes on Not Now and does not ask again', async () => {
    searchParams = new URLSearchParams('passwordReset=1');
    const user = userEvent.setup();
    const { rerender } = render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: /not now/i }));
    rerender(<ProfilePage />);

    expect(screen.queryByRole('heading', { name: /update your password\?/i })).toBeNull();
  });

  it('does not sign the member out - this session is one they asked for', async () => {
    searchParams = new URLSearchParams('passwordReset=1');
    const { unmount } = render(<ProfilePage />);

    unmount();

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('the setup arrival', () => {
  it('is not interrupted twice', () => {
    // passwordSetup=1 already states the account has no password and signs out
    // if they leave, so the recovery dialog would be a second question.
    searchParams = new URLSearchParams('passwordSetup=1');
    render(<ProfilePage />);

    expect(screen.queryByRole('heading', { name: /update your password\?/i })).toBeNull();
  });

  it('leaves an ordinary profile visit alone', () => {
    searchParams = new URLSearchParams();
    render(<ProfilePage />);

    expect(screen.queryByRole('heading', { name: /update your password\?/i })).toBeNull();
  });
});
