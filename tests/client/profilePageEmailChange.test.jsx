import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The email field was read-only with "Email changes are handled separately",
// and separately meant asking an admin. It is now a two-step change, and the
// two steps are the point: the address a member types here becomes the one
// they SIGN IN with, so a typo applied straight away would send password reset
// to somewhere they cannot read. The same harness as profilePageEditing.test.jsx.
//
// It lives in its OWN form, beside Change Password, rather than inside the
// profile form. The first version nested it in that form, and the first person
// to use it entered the code, scrolled past Confirm Change to Save Profile and
// pressed that - which saves every field EXCEPT the email, so the change
// silently did not happen. Hence the test below that Save Profile sends no
// email, and the copy saying so on both sections.
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
const firestoreMocks = vi.hoisted(() => ({ update: vi.fn() }));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(() => ({
    commit: vi.fn(() => Promise.resolve()),
    delete: vi.fn(),
    set: vi.fn(),
    update: (...args) => firestoreMocks.update(...args)
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

// No toggle and no edit mode: the section is always on the page, like Change
// Password. One fewer state to be in, and nothing to fail to find.
async function openEmailChange() {
  render(<ProfilePage />);
  await waitFor(() => {
    expect(screen.getByRole('heading', { name: 'Change Email Address' })).toBeInTheDocument();
  });
}

beforeEach(() => {
  startOwnEmailChangeMock.mockReset();
  confirmOwnEmailChangeMock.mockReset();
  reloadMock.mockClear();
  firestoreMocks.update.mockClear();
  authState.currentUser = { email: 'member@example.com', reload: reloadMock, uid: 'user-1' };
});

afterEach(cleanup);

describe('changing your own email address', () => {
  it('asks for a code before it asks for anything else', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockResolvedValue({ message: 'We sent a six-digit code.' });

    await openEmailChange();

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

    await openEmailChange();
    expect(screen.getByRole('button', { name: 'Send Code' })).toBeDisabled();

    await user.type(screen.getByLabelText(/New Email Address/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: 'Confirm Email Change' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Six-Digit Code/i), '12345');
    expect(screen.getByRole('button', { name: 'Confirm Email Change' })).toBeDisabled();
    await user.type(screen.getByLabelText(/Six-Digit Code/i), '6');
    expect(screen.getByRole('button', { name: 'Confirm Email Change' })).toBeEnabled();
  });

  it('shows the new address once the code is accepted', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockResolvedValue({ message: 'Sent.' });
    confirmOwnEmailChangeMock.mockResolvedValue({
      email: 'new@example.com',
      message: 'Your email address has been changed.'
    });

    await openEmailChange();
    await user.type(screen.getByLabelText(/New Email Address/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/Six-Digit Code/i), '123456');
    await user.click(screen.getByRole('button', { name: 'Confirm Email Change' }));

    expect(confirmOwnEmailChangeMock).toHaveBeenCalledWith('123456');
    await waitFor(() => {
      expect(screen.getByText('Your email address has been changed.')).toBeInTheDocument();
    });

    // The displayed address comes from the server's answer. Neither usual
    // source refreshes on its own here: currentUser.email stays cached on the
    // Auth object, and onAuthStateChanged does not fire for a server-side
    // change - so without this the page would still show the old address
    // after a successful change.
    expect(screen.getByLabelText('Current Email')).toHaveValue('new@example.com');
  });

  it('keeps the form open and the code box filled when the code is wrong', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockResolvedValue({ message: 'Sent.' });
    confirmOwnEmailChangeMock.mockRejectedValue(new Error('That code is incorrect.'));

    await openEmailChange();
    await user.type(screen.getByLabelText(/New Email Address/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    });
    await user.type(screen.getByLabelText(/Six-Digit Code/i), '999999');
    await user.click(screen.getByRole('button', { name: 'Confirm Email Change' }));

    await waitFor(() => {
      expect(screen.getByText('That code is incorrect.')).toBeInTheDocument();
    });
    // Still on the code step, so another attempt does not start over.
    expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Current Email')).toHaveValue('member@example.com');
  });

  it('reports a refused address without moving on to the code step', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockRejectedValue(
      new Error('Another account already uses that email address.')
    );

    await openEmailChange();
    await user.type(screen.getByLabelText(/New Email Address/i), 'taken@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));

    await waitFor(() => {
      expect(
        screen.getByText('Another account already uses that email address.')
      ).toBeInTheDocument();
    });
    expect(screen.queryByLabelText(/Six-Digit Code/i)).toBeNull();
  });

  it('Start Over puts the form back to the first step', async () => {
    const user = userEvent.setup();
    startOwnEmailChangeMock.mockResolvedValue({ message: 'Sent.' });

    await openEmailChange();
    await user.type(screen.getByLabelText(/New Email Address/i), 'new@example.com');
    await user.click(screen.getByRole('button', { name: 'Send Code' }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Six-Digit Code/i)).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: 'Start Over' }));

    expect(screen.getByRole('button', { name: 'Send Code' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Six-Digit Code/i)).toBeNull();
    expect(screen.getByLabelText(/New Email Address/i)).toHaveValue('');
  });

  it('is not part of the profile form, and Save Profile sends no email', async () => {
    const user = userEvent.setup();

    render(<ProfilePage />);
    await user.click(screen.getByRole('button', { name: /Edit Profile/i }));
    await user.click(screen.getByRole('button', { name: /Save Profile/i }));

    // The whole reported failure in one assertion: whatever Save Profile does,
    // it must not be the thing a member reaches for to finish an email change,
    // and it must never write the email field - currentUser.email is cached on
    // the Auth object, so sending it would put the old address back.
    await waitFor(() => {
      expect(firestoreMocks.update).toHaveBeenCalled();
    });
    firestoreMocks.update.mock.calls.forEach(([, payload]) => {
      expect(payload).not.toHaveProperty('email');
    });
  });
});
