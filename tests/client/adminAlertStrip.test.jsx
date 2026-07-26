import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authState = { hasPermission: () => false, isSuperUser: false, userProfile: {} };
let usersSnapshot = { docs: [] };
let registrationsSnapshot = { docs: [] };

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => authState
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null })
}));

vi.mock('../../src/services/eventService.js', () => ({
  archiveEvent: vi.fn(),
  reactivateEvent: vi.fn(),
  subscribeToAdminEvents: () => () => {}
}));

vi.mock('../../src/services/registrationService.js', () => ({
  loadPublicRegistrationCounts: () => Promise.resolve({}),
  subscribeToRegistrations: (onNext) => {
    onNext(registrationsSnapshot);
    return () => {};
  },
  subscribeToSquareWebhookEvents: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));

vi.mock('../../src/services/userService.js', () => ({
  subscribeToUsers: (onNext) => {
    onNext(usersSnapshot);
    return () => {};
  }
}));

vi.mock('../../src/components/PageHeader.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/ConfigurationPanel.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/EventForm.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/EventList.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/PaymentReconciliationPanel.jsx', () => ({
  default: () => <div data-testid="payment-review-panel" />
}));
vi.mock('../../src/components/admin/RegistrationPanel.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/UserControlPanel.jsx', () => ({ default: () => null }));

const { default: AdminDashboardPage } = await import('../../src/pages/AdminDashboardPage.jsx');

function signInAs({ permissions = [], isSuperUser = false } = {}) {
  authState.hasPermission = (permission) => permissions.includes(permission);
  authState.isSuperUser = isSuperUser;
}

function docsOf(records) {
  return records.map((data, index) => ({ id: `doc-${index}`, data: () => data }));
}

beforeEach(() => {
  usersSnapshot = { docs: [] };
  registrationsSnapshot = { docs: [] };
});

afterEach(cleanup);

describe('the Needs Attention alert strip', () => {
  it('reads as all-clear, unstyled, when nothing is pending', () => {
    signInAs({ permissions: ['manageMembershipStatus', 'viewRegistrations'] });
    render(<AdminDashboardPage />);

    const membershipChip = screen.getByRole('button', { name: 'No membership reviews pending' });
    const paymentChip = screen.getByRole('button', { name: 'Payment Review' });

    expect(membershipChip.className).not.toContain('pending');
    expect(paymentChip.className).not.toContain('pending');
    // The payment chip drops its dot entirely at zero, so it reads as a
    // plain entry point rather than an alert with nothing to report.
    expect(paymentChip.querySelector('.admin-alert-dot')).toBeNull();
  });

  it('names the count and switches to the pending style once something needs attention', () => {
    usersSnapshot = {
      docs: docsOf([
        { membershipStatus: 'Pending', role: 'General User' },
        { membershipStatus: 'Pending', role: 'General User' }
      ])
    };
    registrationsSnapshot = {
      docs: docsOf([
        { paymentStatus: 'Pending', status: 'Registered' }
      ])
    };
    signInAs({ permissions: ['manageMembershipStatus', 'viewRegistrations'] });
    render(<AdminDashboardPage />);

    const membershipChip = screen.getByRole('button', { name: '2 membership reviews pending' });
    const paymentChip = screen.getByRole('button', { name: '1 payment needs review' });

    expect(membershipChip.className).toContain('pending');
    expect(paymentChip.className).toContain('pending');
    expect(paymentChip.querySelector('.admin-alert-dot')).not.toBeNull();
  });

  it('does not render at all for an admin with neither permission', () => {
    signInAs({ permissions: [] });
    render(<AdminDashboardPage />);

    expect(screen.queryByRole('navigation', { name: 'Needs attention' })).toBeNull();
  });

  it('opens Payment Review when the chip is clicked, its only entry point now that the tab is gone', async () => {
    const user = userEvent.setup();
    signInAs({ permissions: ['viewRegistrations'] });
    render(<AdminDashboardPage />);

    await user.click(screen.getByRole('button', { name: 'Payment Review' }));

    expect(screen.getByTestId('payment-review-panel')).toBeInTheDocument();
  });
});
