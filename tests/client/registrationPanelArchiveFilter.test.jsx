import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>
}));

// Both events fall on today's own date, so they always land in whatever the
// panel's default year/quarter filters resolve to at run time - this test
// only cares about the Active/Archived split, not the date filters.
const TODAY = new Date().toISOString().slice(0, 10);

vi.mock('../../src/services/eventService.js', () => ({
  subscribeToAdminEvents: (onNext) => {
    onNext({
      docs: [
        {
          id: 'evt-active',
          data: () => ({ cost: 25, date: TODAY, eventType: 'Workshop', isPaid: true, status: 'Published', title: 'Live Workshop' })
        },
        {
          id: 'evt-archived',
          data: () => ({ date: TODAY, eventType: 'Workshop', status: 'Archived', title: 'Past Workshop' })
        }
      ]
    });
    return () => {};
  },
  subscribeToPublishedEvents: () => () => {}
}));

vi.mock('../../src/services/registrationService.js', () => ({
  cancelRegistration: vi.fn(),
  subscribeToPayments: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  },
  subscribeToRegistrations: (onNext) => {
    onNext({
      docs: [
        {
          id: 'reg-active',
          data: () => ({
            amountPaid: 25,
            eventId: 'evt-active',
            name: 'Ada Lovelace',
            paymentStatus: 'Paid',
            registrationDate: '2026-07-01',
            status: 'Registered'
          })
        },
        {
          id: 'reg-archived',
          data: () => ({
            eventId: 'evt-archived',
            name: 'Grace Hopper',
            paymentStatus: 'Paid',
            registrationDate: '2026-05-01',
            status: 'Registered'
          })
        }
      ]
    });
    return () => {};
  },
  updateRegistrationPayment: vi.fn()
}));

vi.mock('../../src/services/userService.js', () => ({
  subscribeToUsers: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));

vi.mock('../../src/services/configurationService.js', () => ({
  DEFAULT_PAYMENT_SETTINGS: { allowAppInitiatedRefunds: false },
  subscribeToPaymentSettings: (onNext) => {
    onNext({ allowAppInitiatedRefunds: false });
    return () => {};
  }
}));

const { default: RegistrationPanel } = await import('../../src/components/admin/RegistrationPanel.jsx');

afterEach(cleanup);

describe('Registrations card archive filter', () => {
  it('hides an archived event and its registrations by default', () => {
    render(<RegistrationPanel canManageEvents currentUserProfile={{}} />);

    expect(screen.getByText('Live Workshop')).toBeTruthy();
    expect(screen.queryByText('Past Workshop')).toBeNull();
  });

  it('shows the archived event once the Archived filter is selected', async () => {
    const user = userEvent.setup();
    render(<RegistrationPanel canManageEvents currentUserProfile={{}} />);

    await user.click(screen.getByRole('button', { name: /^Archived/ }));

    expect(screen.getByText('Past Workshop')).toBeTruthy();
    expect(screen.queryByText('Live Workshop')).toBeNull();
  });

  it('returns to Active after Reset Filters', async () => {
    const user = userEvent.setup();
    render(<RegistrationPanel canManageEvents currentUserProfile={{}} />);

    await user.click(screen.getByRole('button', { name: /^Archived/ }));
    expect(screen.getByText('Past Workshop')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Reset Filters' }));

    expect(screen.getByText('Live Workshop')).toBeTruthy();
    expect(screen.queryByText('Past Workshop')).toBeNull();
  });

  it('shows a Total Paid figure on a paid event\'s summary card', () => {
    render(<RegistrationPanel canManageEvents currentUserProfile={{}} />);

    expect(screen.getByText(/\$25\.00 Total Paid/)).toBeTruthy();
  });

  it('links to the registration print page for the drilled-in event', async () => {
    const user = userEvent.setup();
    render(<RegistrationPanel canManageEvents currentUserProfile={{}} />);

    await user.click(screen.getByRole('button', { name: 'View/Edit Registrations' }));

    const link = screen.getByRole('link', { name: 'Print Registration List' });
    expect(link.getAttribute('href')).toBe('/admin/events/evt-active/registrations/print');
  });
});
