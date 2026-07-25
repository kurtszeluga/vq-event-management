import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ProfilePage pulls in Firebase auth and Firestore directly. None of that is
// involved in the view/edit behaviour under test, so it is stubbed out and the
// profile is supplied through the mocked auth context.
const authState = {
  currentUser: { email: 'member@example.com', uid: 'user-1' },
  loading: false,
  profileError: '',
  userProfile: {
    billingAddress: {
      city: 'Loudon',
      country: 'United States',
      postalCode: '37774',
      state: 'TN',
      street: '12 Awohili Drive'
    },
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '(352) 653-8188',
    role: 'Member'
  }
};

vi.mock('../../src/context/useAuth.js', () => ({ useAuth: () => authState }));
vi.mock('../../src/lib/firebase.js', () => ({ db: {}, firebaseConfigured: true }));
vi.mock('firebase/auth', () => ({ updatePassword: vi.fn(), updateProfile: vi.fn() }));
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  writeBatch: vi.fn(() => ({ update: vi.fn(), set: vi.fn(), commit: vi.fn() }))
}));
vi.mock('../../src/services/memberDirectoryProfile.js', () => ({
  applyMemberDirectorySync: vi.fn()
}));
vi.mock('../../src/components/PageHeader.jsx', () => ({ default: () => null }));
vi.mock('react-router-dom', () => ({
  Link: ({ children }) => <span>{children}</span>,
  Navigate: () => null
}));

const { default: ProfilePage } = await import('../../src/pages/ProfilePage.jsx');

function firstNameInput() {
  return screen.getByLabelText(/First Name/i);
}

beforeEach(() => {
  authState.loading = false;
  authState.profileError = '';
});

afterEach(cleanup);

describe('the profile card', () => {
  // The reported bug: the card opened straight into an editable form, so Cancel
  // had nothing to return to and appeared to do nothing at all.
  it('opens read-only, not in edit mode', () => {
    render(<ProfilePage />);

    expect(screen.getByRole('button', { name: 'Edit Profile' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByLabelText(/First Name/i)).toBeNull();
  });

  it('shows the stored details in the read-only view', () => {
    render(<ProfilePage />);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('member@example.com')).toBeInTheDocument();
    expect(screen.getByText('(352) 653-8188')).toBeInTheDocument();
    expect(
      screen.getByText('12 Awohili Drive, Loudon, TN 37774, United States')
    ).toBeInTheDocument();
  });

  it('says "Not provided" rather than showing a blank for missing details', () => {
    authState.userProfile = { firstName: '', lastName: '', phone: '', role: 'Member' };
    render(<ProfilePage />);

    expect(screen.getAllByText('Not provided').length).toBeGreaterThanOrEqual(2);

    authState.userProfile = {
      billingAddress: {
        city: 'Loudon',
        country: 'United States',
        postalCode: '37774',
        state: 'TN',
        street: '12 Awohili Drive'
      },
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '(352) 653-8188',
      role: 'Member'
    };
  });
});

describe('entering and leaving edit mode', () => {
  it('reveals the form on Edit Profile', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: 'Edit Profile' }));

    expect(firstNameInput()).toHaveValue('Ada');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Profile' })).toBeNull();
  });

  it('reverts an edit and returns to the read-only view on Cancel', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: 'Edit Profile' }));
    await user.clear(firstNameInput());
    await user.type(firstNameInput(), 'Grace');
    expect(firstNameInput()).toHaveValue('Grace');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Back to the view, and the typed value is gone rather than lingering.
    expect(screen.getByRole('button', { name: 'Edit Profile' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.queryByText(/Grace/)).toBeNull();
  });

  it('re-entering edit mode shows the restored value, not the abandoned one', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: 'Edit Profile' }));
    await user.clear(firstNameInput());
    await user.type(firstNameInput(), 'Grace');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Edit Profile' }));

    expect(firstNameInput()).toHaveValue('Ada');
  });

  it('clears a failed save\'s error when cancelling, and stays put while it is showing', async () => {
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: 'Edit Profile' }));
    await user.clear(firstNameInput());

    // Submitted directly rather than by clicking Save. Clearing the field makes
    // the input fail its own `required` attribute, so a click is swallowed by
    // native constraint validation and handleSubmit never runs - which is
    // correct browser behaviour, but leaves the page's own trim() check
    // untested. This reaches that branch.
    fireEvent.submit(firstNameInput().closest('form'));

    await waitFor(() => {
      expect(screen.getByText('First name and last name are required.')).toBeInTheDocument();
    });
    // A refused save must not drop the user back to the view and discard input.
    expect(screen.queryByRole('button', { name: 'Edit Profile' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Edit Profile' })).toBeInTheDocument();
    expect(screen.queryByText('First name and last name are required.')).toBeNull();
  });
});

describe('states that replace the card entirely', () => {
  it('shows a loading state without touching the profile', () => {
    authState.loading = true;
    render(<ProfilePage />);

    expect(screen.getByText('Loading Profile')).toBeInTheDocument();
  });

  // The null-profile crash this page used to have: the mount effect ran the name
  // helpers before any early return could take over.
  it('does not throw when the profile has not arrived yet', () => {
    authState.loading = true;
    authState.userProfile = null;

    expect(() => render(<ProfilePage />)).not.toThrow();

    authState.userProfile = {
      firstName: 'Ada',
      lastName: 'Lovelace',
      phone: '(352) 653-8188',
      role: 'Member'
    };
  });
});
