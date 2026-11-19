import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The email field was read-only with "Email changes are handled separately",
// and separately meant asking an admin. It is now a two-step change, and the
// two steps are the point: the address a member types here becomes the one
// they SIGN IN with, so a typo applied straight away would send password reset
// to somewhere they cannot read. The same harness as profilePageEditing.test.jsx.
const startOwnEmailChangeMock = vi.fn();
const confirmOwnEmailChangeMock = vi.fn();
const reloadMock = vi.fn(() => Promise.resolve());

const authState = {
  currentUser: { email: 'member@example.com', reload: reloadMock, uid: 'user-1' },
  loading: false,
  profileError: '',
  userProfile: {
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '(352) 653-8188',
    role: 'Member'
  }
};

vi.mock('../../src/context/useAuth.js', () => ({ useAuth: () => authState }));
vi.mock('../../src/lib/firebase.js', () => ({ db: {}, firebaseConfigured: true }));
vi.mock('firebase/auth', () => ({ updatePassword: vi.fn(), updateProfile: vi.fn() }));
vi.mock('../../src/services/registrationService.js', () => ({
  subscribeToMembershipPayments: (userId, onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));
vi.mock('../../src/services/userService.js', () => ({
  confirmOwnEmailChange: (...args) => confirmOwnEmailChangeMock(...args),
  startOwnEmailChange: (...args) => startOwnEmailChangeMock(...args)
}));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(() => ({
    commit: vi.fn(() => Promise.resolve()),
    delete: vi.fn(),
    set: vi.fn(),
    update: vi.fn()
  }))
}));
vi.mock('../../src/services/memberDirectoryProfile.js', () => ({
  applyMemberDirectorySync: vi.fn()
}));
vi.mock('../../src/components/PageHeader.jsx', () => ({ default: () => null }));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
  Navigate: () => null,
  useSearchParams: () => [new URLSearchParams()]
}));

const { default: ProfilePage } = await import('../../src/pages/ProfilePage.jsx');

async function openEmailChange(user) {
  render(<ProfilePage />);
  await user.click(screen.getByRole('button', { name: /Edit Profile/i }));
  await user.click(screen.getByRole('button', { name: 'Change Email Address' }));
}

beforeEach(() => {
  startOwnEmailChangeMock.mockReset();
  confirmOwnEmailChangeMock.mockReset();
  reloadMock.mockClear();
  authState.currentUser = { email: 'member@example.com', reload: reloadMock, uid: 'user-1' };
});

afterEach(cleanup);

describe('changing your own email address', () => {
  it('asks for a code before it asks for anything else', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockResolvedValue({ message: 'We sent a six-digit code.' });

    await openEmailChange(user);

    // No code box yet - nothing has been sent.
    expect(screen.queryByLabelText(/Six-Digit Code/i)).toBeNull();

    await user.type(screen.getByLabelText(/New Email Address/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));

    expect(startOwnEmailChangeMock).toHaveBeenCalledWith('new@example.com');
    await waitFor(() => {
      expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    });
    // And the change itself has not been attempted.
    expect(confirmOwnEmailChangeMock).not.toHaveBeenCalled();
  });

  it('will not send without an address, or confirm without six digits', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockResolvedValue({ message: 'Sent.' });

    await openEmailChange(user);
    expect(screen.getByRole('button', { name: 'Send Code' })).toBeDisabled();

    await user.type(screen.getByLabelText(/New Email Address/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Confirm Change' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Six-Digit Code/i), '12345');
    expect(screen.getByRole('button', { name: 'Confirm Change' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Six-Digit Code/i), '6');
    expect(screen.getByRole('button', { name: 'Confirm Change' })).toBeEnabled();
  });

  it('shows the new address once the code is accepted', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockResolvedValue({ message: 'Sent.' });
    confirmOwnEmailChangeMock.mockResolvedValue({
      email: 'new@example.com',
      message: 'Your email address has been changed.'
    });

    await openEmailChange(user);
    await user.type(screen.getByLabelText(/New Email Address/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/Six-Digit Code/i), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm Change' }));

    expect(confirmOwnEmailChangeMock).toHaveBeenCalledWith('123456');
    await waitFor(() => {
      expect(screen.getByText('Your email address has been changed.')).toBeInTheDocument();
    });

    // The displayed address comes from the server's answer. Neither usual
    // source refreshes on its own here: currentUser.email stays cached on the
    // Auth object, and onAuthStateChanged does not fire for a server-side
    // change - so without this the page would still show the old address
    // after a successful change.
    expect(screen.getByDisplayValue('new@example.com')).toBeInTheDocument();
  });

  it('keeps the form open and the code box filled when the code is wrong', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockResolvedValue({ message: 'Sent.' });
    confirmOwnEmailChangeMock.mockRejectedValue(new Error('That code is incorrect.'));

    await openEmailChange(user);
    await user.type(screen.getByLabelText(/New Email Address/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/Six-Digit Code/i), '999999');
    await user.click(screen.getByRole('button', { name: 'Confirm Change' }));

    await waitFor(() => {
      expect(screen.getByText('That code is incorrect.')).toBeInTheDocument();
    });
    // Still on the code step, so another attempt does not start over.
    expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue('member@example.com')).toBeInTheDocument();
  });

  it('reports a refused address without moving on to the code step', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockRejectedValue(
      new Error('Another account already uses that email address.')
    );

    await openEmailChange(user);
    await user.type(screen.getByLabelText(/New Email Address/i), 'taken@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));

    await waitFor(() => {
      expect(
        screen.getByText('Another account already uses that email address.')
      ).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Six-Digit Code/i)).toBeNull();
  });

  it('Cancel puts everything back', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockResolvedValue({ message: 'Sent.' });

    await openEmailChange(user);
    await user.type(screen.getByLabelText(/New Email Address/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Cancel Email Change' }));

    expect(screen.getByRole('button', { name: 'Change Email Address' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/New Email Address/i)).toBeNull();
  });
});
