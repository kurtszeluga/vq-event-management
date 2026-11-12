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

const ADMIN = {
  currentUser: { email: 'boss@example.com', displayName: 'Boss Person' },
  hasPermission: () => true,
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
  it('is the last nav link for an admin', () => {
    renderApp(ADMIN);
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
});

describe('home page for an admin', () => {
  it('shows the normal home page, not the admin dashboard', () => {
    authState.value = ADMIN;
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
