import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Programs tab appeared and listed nothing.
//
// The events subscription was gated on canManageEvents alone, so an admin
// holding only managePrograms never fetched the events collection at all -
// and an unfetched list renders exactly like an empty one: "No events yet".
// The tab, the permission, the rules and the API were all correct; the data
// was simply never asked for.
//
// These tests drive the real AdminDashboardPage with a Programs-only profile
// and assert that the subscription runs, which is the thing that was missing.

let permissions = {};
let subscribeCalled = 0;

const EVENTS = [
  { date: '2027-03-01', eventType: 'Lecture', id: 'e1', status: 'Published', title: 'Quilt History' },
  { date: '2027-03-02', eventType: 'Class (Half Day)', id: 'e2', status: 'Published', title: 'Binding Basics' },
  { date: '2027-03-03', eventType: 'Workshop', id: 'e3', status: 'Published', title: 'Longarm Day' }
];

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => ({
    hasPermission: (key) => Boolean(permissions[key]),
    isSuperUser: false,
    userProfile: { name: 'Program Lead', role: 'Admin', status: 'Active' }
  })
}));
vi.mock('../../src/services/eventService.js', () => ({
  archiveEvent: vi.fn(),
  reactivateEvent: vi.fn(),
  subscribeToAdminEvents: (onNext) => {
    subscribeCalled += 1;
    onNext({ docs: EVENTS.map((event) => ({ data: () => event, id: event.id })) });
    return () => {};
  }
}));
vi.mock('../../src/services/registrationService.js', () => ({
  loadPublicRegistrationCounts: () => Promise.resolve({}),
  subscribeToRegistrations: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  },
  subscribeToSquareWebhookEvents: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));
vi.mock('../../src/services/userService.js', () => ({
  subscribeToUsers: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));
vi.mock('../../src/components/PageHeader.jsx', () => ({ default: () => null }));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
  useLocation: () => ({ state: null })
}));

const { default: AdminDashboardPage } = await import('../../src/pages/AdminDashboardPage.jsx');

beforeEach(() => {
  permissions = {};
  subscribeCalled = 0;
});

afterEach(cleanup);

describe('a Programs-only admin', () => {
  it('fetches events, which is what the empty tab was missing', async () => {
    permissions = { managePrograms: true };

    render(<AdminDashboardPage />);

    await waitFor(() => expect(subscribeCalled).toBeGreaterThan(0));
  });

  it('gets a Programs tab and no Events/Activities tab', () => {
    permissions = { managePrograms: true };

    render(<AdminDashboardPage />);

    expect(screen.getByRole('button', { name: 'Programs' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Events/Activities' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Challenges' })).toBeNull();
  });

  it('is not told there are no admin modules enabled', () => {
    permissions = { managePrograms: true };

    render(<AdminDashboardPage />);

    expect(screen.queryByText('No Admin Modules Enabled')).toBeNull();
  });
});

describe('an Events-only admin', () => {
  it('still fetches events and gets the other tabs, but not Programs', () => {
    permissions = { manageEvents: true };

    render(<AdminDashboardPage />);

    expect(subscribeCalled).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Events/Activities' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Challenges' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Programs' })).toBeNull();
  });
});

describe('an admin with neither', () => {
  it('does not fetch events at all', () => {
    permissions = { viewRegistrations: true };

    render(<AdminDashboardPage />);

    expect(subscribeCalled).toBe(0);
  });
});
