import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  // This block used to assert the opposite. 1e6182f (14 Nov) offered both
  // controls on an unavailable event so that the destination could explain
  // itself; reported on 20 Nov, that explanation turned out to be a wasted
  // click to read "Registration is not currently open for this event" - a
  // sentence the card can show in place. The reason now replaces the
  // controls, which keeps what that change was really protecting: an
  // unavailable event still looks different from a missing permission.
  const CLOSED_WINDOW_EVENT = {
    ...FREE_EVENT,
    id: 'evt-not-open',
    registrationCloseAt: '2026-12-10T17:00',
    registrationMode: 'future',
    registrationOpenAt: '2099-01-01T09:00',
    title: 'Opens Much Later'
  };
  // Open, so the controls themselves can still be exercised below.
  const OPEN_EVENT = {
    ...FREE_EVENT,
    id: 'evt-open',
    registrationCloseAt: '2099-12-10T17:00',
    registrationMode: 'now',
    registrationOpenAt: '2020-01-01T09:00',
    title: 'Open Now'
  };

  it('replaces the controls with the reason when registration has not opened', () => {
    render(
      <EventList
        events={[CLOSED_WINDOW_EVENT]}
        onDelete={() => {}}
        onEdit={() => {}}
      />
    );

    expect(screen.queryByText('Register Myself')).toBeNull();
    expect(screen.getByText(/Registration for this event opens/i)).toBeTruthy();
  });

  it('runs the admin flow for Register Myself when the admin can register others', async () => {
    // An admin registering themselves is still an admin registration - that is
    // what makes the cash/check "payment already received" prompt available,
    // since the server honours it only for an admin-authorized request.
    const onRegisterSelf = vi.fn();
    const user = userEvent.setup();

    render(
      <EventList
        canRegisterOthers
        events={[OPEN_EVENT]}
        onDelete={() => {}}
        onEdit={() => {}}
        onRegisterSelf={onRegisterSelf}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Register Myself' }));

    expect(onRegisterSelf).toHaveBeenCalledWith('evt-open');
  });

  it('falls back to the member page when the admin cannot register others', () => {
    render(
      <EventList
        events={[OPEN_EVENT]}
        onDelete={() => {}}
        onEdit={() => {}}
        onRegisterSelf={() => {}}
      />
    );

    // A link, not a dead control: without the permission behind the admin
    // panel the member-facing page is the right destination.
    expect(screen.queryByRole('button', { name: 'Register Myself' })).toBeNull();
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
