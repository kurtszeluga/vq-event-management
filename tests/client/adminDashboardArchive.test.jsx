import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Focused on the archive/reactivate confirm flow - everything else on the
// dashboard is stubbed out, matching adminModuleNav.test.jsx's approach.
const authState = { hasPermission: () => true, isSuperUser: true, userProfile: { userId: 'admin-1' } };

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => authState
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null })
}));

const archiveEventMock = vi.fn();
const reactivateEventMock = vi.fn();

vi.mock('../../src/services/eventService.js', () => ({
  archiveEvent: (...args) => archiveEventMock(...args),
  reactivateEvent: (...args) => reactivateEventMock(...args),
  subscribeToAdminEvents: (onNext) => {
    onNext({
      docs: [{
        id: 'evt-1',
        data: () => ({ title: 'Witch Hat Wizardry', status: 'Published' })
      }]
    });
    return () => {};
  }
}));

vi.mock('../../src/services/registrationService.js', () => ({
  loadPublicRegistrationCounts: () => Promise.resolve({}),
  subscribeToRegistrations: () => () => {},
  subscribeToSquareWebhookEvents: () => () => {}
}));

vi.mock('../../src/services/userService.js', () => ({
  subscribeToUsers: () => () => {}
}));

vi.mock('../../src/components/PageHeader.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/ConfigurationPanel.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/EventForm.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/EventList.jsx', () => ({
  default: ({ onDelete }) => (
    <div data-testid="event-list">
      <button
        type="button"
        onClick={() => onDelete({ id: 'evt-1', status: 'Published', title: 'Witch Hat Wizardry' })}
      >
        Archive Witch Hat Wizardry
      </button>
    </div>
  )
}));
vi.mock('../../src/components/admin/PaymentReconciliationPanel.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/RegistrationPanel.jsx', () => ({
  default: () => <div data-testid="registration-panel" />
}));
vi.mock('../../src/components/admin/UserControlPanel.jsx', () => ({ default: () => null }));

const { default: AdminDashboardPage } = await import('../../src/pages/AdminDashboardPage.jsx');

beforeEach(() => {
  archiveEventMock.mockReset();
  reactivateEventMock.mockReset();
});

afterEach(cleanup);

describe('archiving an event blocked by pending payments', () => {
  it('shows the server refusal message and leaves only a Cancel button', async () => {
    const user = userEvent.setup();
    archiveEventMock.mockRejectedValue(
      new Error('Cannot archive this event: 2 registrations still have a payment awaiting collection. Resolve them in Payment Review before archiving.')
    );
    render(<AdminDashboardPage />);

    await user.click(screen.getByRole('button', { name: 'Events/Activities' }));
    await user.click(screen.getByRole('button', { name: 'Archive Witch Hat Wizardry' }));
    await user.click(screen.getByRole('button', { name: 'Archive Event' }));

    await waitFor(() => {
      expect(screen.getByText(/2 registrations still have a payment awaiting collection/)).toBeTruthy();
    });

    // The blocked dialog only offers a way out - retrying without fixing
    // anything can't succeed, so the Archive Event button is gone and Keep
    // Event's label reads Cancel instead.
    expect(screen.queryByRole('button', { name: 'Archive Event' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep Event' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(archiveEventMock).toHaveBeenCalledTimes(1);
  });

  it('clears the error and closes the dialog when Cancel is clicked after a refusal', async () => {
    const user = userEvent.setup();
    archiveEventMock.mockRejectedValue(
      new Error('Cannot archive this event: 1 registration still has a payment awaiting collection. Resolve them in Payment Review before archiving.')
    );
    render(<AdminDashboardPage />);

    await user.click(screen.getByRole('button', { name: 'Events/Activities' }));
    await user.click(screen.getByRole('button', { name: 'Archive Witch Hat Wizardry' }));
    await user.click(screen.getByRole('button', { name: 'Archive Event' }));
    await waitFor(() => {
      expect(screen.getByText(/1 registration still has a payment awaiting collection/)).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText(/payment awaiting collection/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('archives normally on a fresh attempt once nothing is pending', async () => {
    const user = userEvent.setup();
    archiveEventMock
      .mockRejectedValueOnce(new Error('Cannot archive this event: 1 registration still has a payment awaiting collection. Resolve them in Payment Review before archiving.'))
      .mockResolvedValueOnce(undefined);
    render(<AdminDashboardPage />);

    await user.click(screen.getByRole('button', { name: 'Events/Activities' }));
    await user.click(screen.getByRole('button', { name: 'Archive Witch Hat Wizardry' }));
    await user.click(screen.getByRole('button', { name: 'Archive Event' }));
    await waitFor(() => {
      expect(screen.getByText(/1 registration still has a payment awaiting collection/)).toBeTruthy();
    });

    // Blocked archives can't be retried in place - close the dialog and
    // start over, as the admin would after resolving the payments.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(screen.getByRole('button', { name: 'Archive Witch Hat Wizardry' }));
    await user.click(screen.getByRole('button', { name: 'Archive Event' }));

    await waitFor(() => {
      expect(screen.queryByText(/payment awaiting collection/)).toBeNull();
    });
    expect(archiveEventMock).toHaveBeenCalledTimes(2);
  });
});
