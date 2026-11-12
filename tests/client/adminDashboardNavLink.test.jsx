import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import App from '../../src/App.jsx';
import HomePage from '../../src/pages/HomePage.jsx';

// The auth shape is swapped per test rather than re-mocked, so one mock
// factory covers admin, member and signed-out in the same file.
const authState = { value: {} };

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => authState.value
}));

// HomePage subscribes to the user list for the pending-membership count; the
// count is not what these tests are about.
vi.mock('../../src/services/userService.js', () => ({
  subscribeToUsers: () => () => {}
}));

// An active Admin whose ticked permissions are whatever is passed in.
// hasPermission() in the real app already requires role Admin and status
// Active, so the set alone decides.
function admin(...permissions) {
  return {
    currentUser: { email: 'admin@example.com', displayName: 'Ada Admin' },
    hasPermission: (key) => permissions.includes(key),
    isAdmin: true,
    isSuperUser: false,
    logOut: vi.fn(),
    userProfile: { role: 'Admin', status: 'Active', membershipStatus: 'Active' }
  };
}

const SUPER_USER = {
  currentUser: { email: 'boss@example.com', displayName: 'Boss Person' },
  // A Super User's stored permission map is irrelevant - the role
  // short-circuits every check - so this models one with nothing ticked.
  hasPermission: () => false,
  isAdmin: true,
  isSuperUser: true,
  logOut: vi.fn(),
  userProfile: { role: 'Super User', status: 'Active', membershipStatus: 'Active' }
};

const MEMBER = {
  currentUser: { email: 'member@example.com' },
  hasPermission: () => false,
  isAdmin: false,
  isSuperUser: false,
  logOut: vi.fn(),
  userProfile: { role: 'Member', status: 'Active', membershipStatus: 'Active' }
};

const SIGNED_OUT = {
  currentUser: null,
  hasPermission: () => false,
  isAdmin: false,
  isSuperUser: false,
  logOut: vi.fn(),
  userProfile: null
};

function renderApp(auth) {
  authState.value = auth;

  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="*" element={<App />} />
      </Routes>
    </MemoryRouter>
  );
}

function navLabels() {
  const nav = screen.getByRole('navigation', { name: 'Primary navigation' });

  return within(nav)
    .getAllByRole('link')
    .map((link) => link.textContent);
}

afterEach(cleanup);

describe('Admin Dashboard nav link', () => {
  it('is the last nav link for a super user', () => {
    renderApp(SUPER_USER);
    const labels = navLabels();
    expect(labels).toContain('Admin Dashboard');
    expect(labels[labels.length - 1]).toBe('Admin Dashboard');
  });

  it('is absent for a signed-in non-admin', () => {
    renderApp(MEMBER);
    expect(navLabels()).not.toContain('Admin Dashboard');
  });

  it('is absent when signed out', () => {
    renderApp(SIGNED_OUT);
    expect(navLabels()).not.toContain('Admin Dashboard');
  });

  // The link is gated on the dashboard having at least one module to show,
  // which is narrower than the isAdmin check RequireAdmin applies to /admin.
  it.each([['manageEvents'], ['addUsers'], ['viewRegistrations']])(
    'is shown for an admin with only %s',
    (permission) => {
      renderApp(admin(permission));
      expect(navLabels()).toContain('Admin Dashboard');
    }
  );

  // These three permissions are real, but none of them puts a module on the
  // dashboard - the page would only say "No Admin Modules Enabled".
  it.each([['managePayments'], ['registerOthers'], ['manageWaitlist']])(
    'is hidden for an admin with only %s',
    (permission) => {
      renderApp(admin(permission));
      expect(navLabels()).not.toContain('Admin Dashboard');
    }
  );

  it('is hidden for an admin with no permissions at all', () => {
    renderApp(admin());
    expect(navLabels()).not.toContain('Admin Dashboard');
  });
});

describe('home page for an admin', () => {
  it('shows the normal home page, not the admin dashboard', () => {
    authState.value = SUPER_USER;
    render(
      <MemoryRouter initialEntries={['/']}>
        <HomePage />
      </MemoryRouter>
    );

    expect(screen.getByRole('heading', { name: 'The Village Quilters Network' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Events / Activities' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Business Listings' })).toBeInTheDocument();
  });
});
