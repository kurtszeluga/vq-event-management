import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ArchivePanel from '../../src/components/admin/ArchivePanel.jsx';

const ARCHIVED_EVENT = {
  id: 'evt-archived',
  date: '2026-06-01',
  eventType: 'Workshop',
  isPaid: true,
  location: 'Guild Hall',
  status: 'Archived',
  title: 'Past Workshop'
};
const ACTIVE_EVENT = {
  id: 'evt-active',
  date: '2026-08-01',
  eventType: 'Workshop',
  isPaid: true,
  location: 'Guild Hall',
  status: 'Published',
  title: 'Live Workshop'
};
const REGISTRATIONS = [
  {
    id: 'reg-1',
    amountPaid: 25,
    email: 'ada@example.com',
    eventId: 'evt-archived',
    name: 'Ada Lovelace',
    paymentStatus: 'Paid',
    registrationDate: '2026-05-01',
    status: 'Registered'
  },
  {
    id: 'reg-2',
    amountPaid: 25,
    email: 'grace@example.com',
    eventId: 'evt-archived',
    name: 'Grace Hopper',
    paymentStatus: 'Paid',
    registrationDate: '2026-05-02',
    status: 'Registered'
  },
  {
    id: 'reg-3',
    amountPaid: 0,
    email: 'linus@example.com',
    eventId: 'evt-archived',
    name: 'Linus Torvalds',
    paymentStatus: 'Pending',
    registrationDate: '2026-05-03',
    status: 'Waitlisted'
  }
];

afterEach(cleanup);

describe('ArchivePanel', () => {
  it('only lists archived events, with their registrant count and total paid', () => {
    render(
      <ArchivePanel
        canViewRegistrations
        events={[ARCHIVED_EVENT, ACTIVE_EVENT]}
        registrationsByEventId={{ 'evt-archived': REGISTRATIONS }}
      />
    );

    expect(screen.getByText('Past Workshop')).toBeTruthy();
    expect(screen.queryByText('Live Workshop')).toBeNull();
    expect(screen.getByText('$50.00')).toBeTruthy();
  });

  it('shows an empty state when there are no archived events', () => {
    render(<ArchivePanel canViewRegistrations events={[ACTIVE_EVENT]} registrationsByEventId={{}} />);

    expect(screen.getByText('No archived events')).toBeTruthy();
  });

  it('drills into an event to show its full registrant table, including the waitlisted registrant', async () => {
    const user = userEvent.setup();
    render(
      <ArchivePanel
        canViewRegistrations
        events={[ARCHIVED_EVENT]}
        registrationsByEventId={{ 'evt-archived': REGISTRATIONS }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View Registrants' }));

    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    expect(screen.getByText('Linus Torvalds')).toBeTruthy();
    // Total Paid only counts the two Paid registrations, not the waitlisted one.
    expect(screen.getAllByText('$50.00').length).toBeGreaterThan(0);
  });

  it('does not show registrant details or the Total Paid figure without viewRegistrations', () => {
    render(
      <ArchivePanel
        events={[ARCHIVED_EVENT]}
        registrationsByEventId={{ 'evt-archived': REGISTRATIONS }}
      />
    );

    expect(screen.queryByRole('button', { name: 'View Registrants' })).toBeNull();
    expect(screen.queryByText('$50.00')).toBeNull();
    // Un-archive still works even without registration visibility.
    expect(screen.getByRole('button', { name: 'Un-archive' })).toBeTruthy();
  });

  it('calls onReactivate with the event when Un-archive is clicked', async () => {
    const user = userEvent.setup();
    const onReactivate = vi.fn();
    render(
      <ArchivePanel
        canViewRegistrations
        events={[ARCHIVED_EVENT]}
        onReactivate={onReactivate}
        registrationsByEventId={{ 'evt-archived': REGISTRATIONS }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Un-archive' }));

    expect(onReactivate).toHaveBeenCalledWith(ARCHIVED_EVENT);
  });

  it('opens a print window with the report when Print Report is clicked', async () => {
    const user = userEvent.setup();
    const popup = { document: { close: vi.fn(), open: vi.fn(), write: vi.fn() }, focus: vi.fn() };
    const windowOpenSpy = vi.spyOn(window, 'open').mockReturnValue(popup);

    render(
      <ArchivePanel
        canViewRegistrations
        events={[ARCHIVED_EVENT]}
        registrationsByEventId={{ 'evt-archived': REGISTRATIONS }}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View Registrants' }));
    await user.click(screen.getByRole('button', { name: 'Print Report' }));

    expect(windowOpenSpy).toHaveBeenCalled();
    expect(popup.document.write).toHaveBeenCalledTimes(1);
    expect(popup.document.write.mock.calls[0][0]).toContain('Ada Lovelace');
    expect(popup.document.write.mock.calls[0][0]).toContain('$50.00');

    windowOpenSpy.mockRestore();
  });
});
