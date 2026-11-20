import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
let registrationPanelProps = null;

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
  createEvent: vi.fn(),
  deleteEvent: vi.fn(),
  getEvent: vi.fn(),
  getEventRegistrationSheetState: vi.fn(() => Promise.resolve({})),
  reactivateEvent: vi.fn(),
  subscribeToAdminEvents: (onNext) => {
    subscribeCalled += 1;
    onNext({ docs: EVENTS.map((event) => ({ data: () => event, id: event.id })) });
    return () => {};
  },
  // Reached once a module auto-opens and renders its panel.
  subscribeToPublishedEvents: (onNext) => {
    onNext({ docs: EVENTS.map((event) => ({ data: () => event, id: event.id })) });
    return () => {};
  },
  syncEventRegistrationSheet: vi.fn(),
  updateEvent: vi.fn()
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
// Rendered rather than stubbed to null: the description is the thing under
// test in half of these, and it lives in the header.
vi.mock('../../src/components/PageHeader.jsx', () => ({
  default: ({ description, title }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  )
}));
// The panels themselves are not under test here - this is about which of them
// an account is given and whether their data is fetched - and rendering the
// real ones drags in every service each one touches.
vi.mock('../../src/components/admin/EventList.jsx', () => ({
  default: () => <div data-testid="event-list" />
}));
vi.mock('../../src/components/admin/EventForm.jsx', () => ({
  default: () => <div data-testid="event-form" />
}));
vi.mock('../../src/components/admin/RegistrationPanel.jsx', () => ({
  default: (props) => {
    registrationPanelProps = props;
    return <div data-testid="registration-panel" />;
  }
}));
vi.mock('../../src/components/admin/PaymentReconciliationPanel.jsx', () => ({
  default: () => <div data-testid="payment-review" />
}));
vi.mock('../../src/components/admin/UserControlPanel.jsx', () => ({
  default: () => <div data-testid="user-controls" />
}));
vi.mock('../../src/components/admin/ArchivePanel.jsx', () => ({
  default: () => <div data-testid="archive-panel" />
}));
vi.mock('../../src/components/admin/ConfigurationPanel.jsx', () => ({
  default: () => <div data-testid="configuration-panel" />
}));
vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
  useLocation: () => ({ state: null })
}));

const { default: AdminDashboardPage } = await import('../../src/pages/AdminDashboardPage.jsx');

beforeEach(() => {
  permissions = {};
  subscribeCalled = 0;
  registrationPanelProps = null;
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

describe('the dashboard header and landing', () => {
  it('describes only what this account can manage', async () => {
    // The fixed sentence listed workshops, challenges, business listings and
    // items for sale to an admin who could reach none of them.
    permissions = { managePrograms: true };

    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('Manage programs.')).toBeInTheDocument();
    });
  });

  it('joins several modules readably', async () => {
    permissions = { manageEvents: true, managePrograms: true };

    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(
        screen.getByText(/^Manage programs, events\/activities, .* and archive\.$/)
      ).toBeInTheDocument();
    });
  });

  it('opens the only module instead of asking which one', async () => {
    permissions = { managePrograms: true };

    render(<AdminDashboardPage />);

    // The module's own panel is on screen without anything being clicked.
    await waitFor(() => {
      expect(screen.getByTestId('event-list')).toBeInTheDocument();
    });
  });

  it('still asks when there is more than one module', async () => {
    permissions = { manageEvents: true, managePrograms: true };

    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Programs' })).toBeInTheDocument();
    });
    // Nothing auto-selected, so no panel is showing yet.
    expect(screen.queryByTestId('event-list')).toBeNull();
  });
});

describe('a Programs admin who can also view registrations', () => {
  it('gets the registrations overview on the Programs tab', async () => {
    // It used to be keyed to Events/Activities alone, and the Registrations
    // tab hides for anyone who can manage events - so this account had no
    // route to the overview at all, only the Payment Review chip.
    permissions = { managePrograms: true, viewRegistrations: true };

    render(<AdminDashboardPage />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Registrations/i })).toBeInTheDocument();
    });
  });

  it('still gets no separate Registrations tab, which is deliberate', () => {
    permissions = { managePrograms: true, viewRegistrations: true };

    render(<AdminDashboardPage />);

    // That tab exists only for someone who cannot reach registrations through
    // an events card at all.
    const tabs = screen.getAllByRole('button').map((button) => button.textContent);

    expect(tabs).toContain('Programs');
  });
});

describe('the registrations card a Programs admin opens', () => {
  it('is scoped to Programs, not every activity', async () => {
    // Reported: the card offered Workshops, Retreat, Challenges and
    // Membership filters, and counted every registration in the guild, to an
    // admin who manages classes and lectures.
    permissions = { managePrograms: true, viewRegistrations: true };

    render(<AdminDashboardPage />);

    await userEvent.click(await screen.findByRole('button', { name: /Registrations/i }));
    await waitFor(() => {
      expect(registrationPanelProps).not.toBeNull();
    });
    expect(registrationPanelProps.allowedActivityFilters).toEqual(['Programs']);
  });

  it('is unrestricted for an admin who manages every type', async () => {
    permissions = { manageEvents: true, viewRegistrations: true };

    render(<AdminDashboardPage />);

    await userEvent.click(await screen.findByRole('button', { name: 'Events/Activities' }));
    await userEvent.click(await screen.findByRole('button', { name: /^Registrations$/i }));
    await waitFor(() => {
      expect(registrationPanelProps).not.toBeNull();
    });
    // null, not the full list: Business Listing, For Sale and Other map to no
    // filter button at all and would be dropped by an explicit list.
    expect(registrationPanelProps.allowedActivityFilters).toBeNull();
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
