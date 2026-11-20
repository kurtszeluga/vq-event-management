import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>
}));

const { default: EventList } = await import('../../src/components/admin/EventList.jsx');

// Reported: clicking Register Myself on a class opened a page that said
// "Registration is not currently open for this event". A wasted trip to read
// a sentence the card could have shown.
//
// 1e6182f (14 Nov) had deliberately kept both controls on an unavailable
// event, reasoning that the destination explains itself and that hiding them
// left an admin unable to tell an unavailable event from a missing
// permission. The second half still holds, so the card now shows the reason
// where the buttons were rather than showing nothing.

const BASE = {
  capacity: 10,
  date: '2027-12-01',
  eventType: 'Class (Half Day)',
  id: 'evt-1',
  registrationMode: 'now',
  status: 'Published',
  title: 'Binding Basics'
};

const OPEN = {
  ...BASE,
  registrationCloseAt: new Date(Date.now() + 86_400_000).toISOString(),
  registrationOpenAt: new Date(Date.now() - 86_400_000).toISOString()
};

function renderList(overrides = {}) {
  return render(
    <EventList
      canRegisterOthers
      canViewRegistrations
      events={[{ ...OPEN, ...overrides }]}
      onDelete={() => {}}
      onEdit={() => {}}
      onRegisterMember={() => {}}
      onRegisterSelf={() => {}}
      onViewRegistrations={() => {}}
      registrationCounts={{ 'evt-1': { registered: 0 } }}
    />
  );
}

afterEach(cleanup);

describe('an event that can take a registration', () => {
  it('offers both controls', () => {
    renderList();

    expect(screen.getByRole('button', { name: 'Register Myself' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register A Member' })).toBeInTheDocument();
  });
});

describe('an event that cannot', () => {
  it('shows the reason instead of a button that opens the same sentence', () => {
    renderList({ status: 'Draft' });

    expect(screen.queryByRole('button', { name: 'Register Myself' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Register A Member' })).toBeNull();
    expect(screen.getByText(/still a draft/i)).toBeInTheDocument();
  });

  it('covers the reported case: the window has not opened yet', () => {
    // The part of the 14 November reasoning that still stands: an admin must
    // be able to tell "not open" from "I lack the permission" from "broken".
    // So something is always said where the buttons were.
    renderList({
      registrationOpenAt: new Date(Date.now() + 7 * 86_400_000).toISOString()
    });

    expect(screen.queryByRole('button', { name: 'Register Myself' })).toBeNull();
    // The helper names the date, which is the difference between "come back
    // later" and a dead end.
    expect(screen.getByText(/Registration for this event opens/i)).toBeInTheDocument();
  });

  it('names the date when the listing has not started yet', () => {
    renderList({
      status: 'Published',
      visibleFrom: '2099-03-01T00:00:00.000Z'
    });

    expect(screen.getByText(/not listed on the website until/i)).toBeInTheDocument();
  });
});
