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
