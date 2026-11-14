import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>
}));

const { default: EventList } = await import('../../src/components/admin/EventList.jsx');

const PAID_EVENT = {
  id: 'evt-paid',
  capacity: 20,
  cost: 25,
  date: '2026-08-01',
  eventType: 'Workshop',
  isPaid: true,
  status: 'Published',
  title: 'Paid Workshop'
};
const FREE_EVENT = {
  id: 'evt-free',
  capacity: 20,
  date: '2026-08-01',
  eventType: 'Workshop',
  isPaid: false,
  status: 'Published',
  title: 'Free Meetup'
};

afterEach(cleanup);

describe('EventList Total Paid stat', () => {
  it('shows the admin-only Total Paid figure for a paid event', () => {
    render(
      <EventList
        events={[PAID_EVENT]}
        onDelete={() => {}}
        onEdit={() => {}}
        totalPaidByEventId={{ 'evt-paid': 150 }}
      />
    );

    expect(screen.getByText('Total Paid')).toBeTruthy();
    expect(screen.getByText('$150.00')).toBeTruthy();
  });

  it('never shows a Total Paid figure for a free event, even if a value is passed', () => {
    render(
      <EventList
        events={[FREE_EVENT]}
        onDelete={() => {}}
        onEdit={() => {}}
        totalPaidByEventId={{ 'evt-free': 0 }}
      />
    );

    expect(screen.queryByText('Total Paid')).toBeNull();
  });

  it('omits the Total Paid pill entirely when no figure was supplied (e.g. the admin lacks viewRegistrations)', () => {
    render(<EventList events={[PAID_EVENT]} onDelete={() => {}} onEdit={() => {}} />);

    expect(screen.queryByText('Total Paid')).toBeNull();
  });
});

describe('EventList photo count caption', () => {
  it('shows a singular caption for one photo', () => {
    render(
      <EventList
        events={[{ ...PAID_EVENT, imageUrls: ['photo-1.jpg'] }]}
        onDelete={() => {}}
        onEdit={() => {}}
      />
    );

    expect(screen.getByText('1 Photo')).toBeInTheDocument();
  });

  it('shows a plural caption and counts only real photos, ignoring blank slots', () => {
    render(
      <EventList
        events={[{ ...PAID_EVENT, imageUrls: ['photo-1.jpg', '', 'photo-2.jpg', 'photo-3.jpg', ''] }]}
        onDelete={() => {}}
        onEdit={() => {}}
      />
    );

    expect(screen.getByText('3 Photos')).toBeInTheDocument();
  });

  it('shows no caption at all when the event has no photos', () => {
    render(
      <EventList events={[{ ...PAID_EVENT, imageUrls: [] }]} onDelete={() => {}} onEdit={() => {}} />
    );

    expect(screen.queryByText(/Photo/)).toBeNull();
  });
});

describe('EventList Print Registration List link', () => {
  it('shows the link, pointing at the correct event, when canViewRegistrations is true', () => {
    render(
      <EventList canViewRegistrations events={[PAID_EVENT]} onDelete={() => {}} onEdit={() => {}} />
    );

    const link = screen.getByRole('link', { name: 'Print Registration List' });
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toBe('/admin/events/evt-paid/registrations/print');
  });

  it('hides the link without canViewRegistrations', () => {
    render(<EventList events={[PAID_EVENT]} onDelete={() => {}} onEdit={() => {}} />);

    expect(screen.queryByRole('link', { name: 'Print Registration List' })).toBeNull();
  });

  it('shows the link for a free event too, since registrants can exist regardless of cost', () => {
    render(
      <EventList canViewRegistrations events={[FREE_EVENT]} onDelete={() => {}} onEdit={() => {}} />
    );

    expect(screen.getByRole('link', { name: 'Print Registration List' })).toBeTruthy();
  });
});

describe('EventList registration controls', () => {
  // Both controls are always offered and both refuse with a reason. Hiding
  // Register Myself for a closed window made an unavailable event look like a
  // missing permission or a bug, and threw away the explanation the register
  // page now gives.
  const CLOSED_WINDOW_EVENT = {
    ...FREE_EVENT,
    id: 'evt-not-open',
    registrationCloseAt: '2026-12-10T17:00',
    registrationMode: 'future',
    registrationOpenAt: '2099-01-01T09:00',
    title: 'Opens Much Later'
  };

  it('offers Register Myself even when registration has not opened yet', () => {
    render(
      <EventList
        events={[CLOSED_WINDOW_EVENT]}
        onDelete={() => {}}
        onEdit={() => {}}
      />
    );

    expect(screen.getByText('Register Myself')).toBeTruthy();
  });

  it('reads Join Waitlist only while the window is open and the event is full', () => {
    const full = {
      ...FREE_EVENT,
      capacity: 1,
      id: 'evt-full',
      registrationCloseAt: '2099-12-10T17:00',
      registrationMode: 'now',
      registrationOpenAt: '2020-01-01T09:00',
      title: 'Full And Open'
    };

    render(
      <EventList
        events={[full]}
        onDelete={() => {}}
        onEdit={() => {}}
        registrationCounts={{ 'evt-full': { registered: 1 } }}
      />
    );

    expect(screen.getByText('Join Waitlist')).toBeTruthy();
  });
});
