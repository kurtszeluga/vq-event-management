import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Reported: switching the member directory off in System Config left the nav
// link in place, so a member could still click through to a page that then
// refused them. The link asked only whether this member was allowed to USE
// the directory, never whether the directory was switched on - two different
// questions that had been collapsed into one.

let directorySettings = { enableMemberDirectory: true };
let authState = {};

vi.mock('../../src/context/useAuth.js', () => ({ useAuth: () => authState }));
vi.mock('../../src/services/configurationService.js', () => ({
  subscribeToDirectorySettings: (onNext) => {
    onNext(directorySettings);
    return () => {};
  }
}));
vi.mock('../../src/components/MobileNavSheet.jsx', () => ({ default: () => null }));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
  NavLink: ({ children, to }) => <a href={to}>{typeof children === 'function' ? children({}) : children}</a>,
  Outlet: () => null,
  useLocation: () => ({ pathname: '/' })
}));

const { default: App } = await import('../../src/App.jsx');

const ACTIVE_MEMBER = {
  currentUser: { email: 'member@example.com', uid: 'user-1' },
  hasPermission: () => false,
  isAdmin: false,
  isSuperUser: false,
  logOut: () => {},
  userProfile: { membershipStatus: 'Active', name: 'Ada', status: 'Active' }
};

beforeEach(() => {
  directorySettings = { enableMemberDirectory: true };
  authState = { ...ACTIVE_MEMBER };
});

afterEach(cleanup);

describe('the Member Directory nav link', () => {
  it('shows for an active member while the directory is on', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Member Directory').length).toBeGreaterThan(0);
    });
  });

  it('disappears when the directory is switched off', async () => {
    directorySettings = { enableMemberDirectory: false };

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText('Member Directory')).toBeNull();
    });
  });

  it('stays hidden for someone whose membership is not active', async () => {
    authState = {
      ...ACTIVE_MEMBER,
      userProfile: { membershipStatus: 'Pending', name: 'Ada', status: 'Active' }
    };

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText('Member Directory')).toBeNull();
    });
  });

  it('stays hidden when signed out, without asking for settings at all', async () => {
    authState = { ...ACTIVE_MEMBER, currentUser: null, userProfile: null };

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText('Member Directory')).toBeNull();
    });
  });
});
