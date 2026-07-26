import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/registrationService.js', () => ({
  createAdminRegistration: vi.fn()
}));

const { createAdminRegistration } = await import('../../src/services/registrationService.js');
const { default: AdminRegisterMemberPanel } = await import(
  '../../src/components/admin/AdminRegisterMemberPanel.jsx'
);

const MEMBERS = [
  {
    email: 'ada@example.com',
    firstName: 'Ada',
    id: 'user-1',
    lastName: 'Lovelace',
    phone: '3526538188',
    status: 'Active',
    userId: 'user-1'
  },
  {
    email: 'grace@example.com',
    firstName: 'Grace',
    id: 'user-2',
    lastName: 'Hopper',
    phone: '9195551234',
    status: 'Active',
    userId: 'user-2'
  },
  {
    email: 'nophone@example.com',
    firstName: 'Nora',
    id: 'user-3',
    lastName: 'Phone',
    phone: '',
    status: 'Active',
    userId: 'user-3'
  },
  {
    email: 'inactive@example.com',
    firstName: 'Ivy',
    id: 'user-4',
    lastName: 'Inactive',
    phone: '9195551235',
    status: 'Inactive',
    userId: 'user-4'
  }
];

const FREE_EVENT = { allowCashCheckPayment: false, cost: 0, id: 'event-1', isPaid: false, title: 'Guild Meeting' };
const PAID_CASH_CHECK_EVENT = { allowCashCheckPayment: true, cost: 20, id: 'event-2', isPaid: true, title: 'Retreat' };
const PAID_UNSUPPORTED_EVENT = { allowCashCheckPayment: false, cost: 20, id: 'event-3', isPaid: true, title: 'Workshop' };

function renderPanel(overrides = {}) {
  const props = {
    event: FREE_EVENT,
    onClose: vi.fn(),
    onRegistered: vi.fn(),
    open: true,
    users: MEMBERS,
    ...overrides
  };

  return { props, ...render(<AdminRegisterMemberPanel {...props} />) };
}

async function searchAndSelect(user, term, memberName) {
  await user.type(screen.getByLabelText('Search Members'), term);
  await user.click(screen.getByRole('button', { name: new RegExp(memberName) }));
}

beforeEach(() => {
  createAdminRegistration.mockReset();
});

afterEach(cleanup);

describe('rendering', () => {
  it('renders nothing when closed', () => {
    renderPanel({ open: false });
    expect(screen.queryByText('Register A Member')).toBeNull();
  });

  it('shows no search results until at least 2 characters are typed', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Search Members'), 'a');
    expect(screen.queryByText('ada@example.com')).toBeNull();

    await user.type(screen.getByLabelText('Search Members'), 'd');
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
  });

  it('matches on name, email, or phone', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Search Members'), '919555');
    expect(screen.getByText('grace@example.com')).toBeInTheDocument();
    expect(screen.queryByText('ada@example.com')).toBeNull();
  });

  it('shows a "no members found" message for a non-matching search', async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.type(screen.getByLabelText('Search Members'), 'zzzzz');
    expect(screen.getByText('No members found.')).toBeInTheDocument();
  });
});

describe('selecting a member', () => {
  it('shows the profile name and phone read-only, with no editable fields', async () => {
    const user = userEvent.setup();
    renderPanel();

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('(352) 653-8188')).toBeInTheDocument();
    expect(screen.queryByLabelText('First Name *')).toBeNull();
    expect(screen.queryByLabelText('Last Name *')).toBeNull();
    expect(screen.queryByLabelText('Phone *')).toBeNull();
    expect(screen.getByText(/cannot be edited here/)).toBeInTheDocument();
  });

  it('returns to search when Change is clicked, clearing the selected member', async () => {
    const user = userEvent.setup();
    renderPanel();

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: 'Change' }));

    expect(screen.getByLabelText('Search Members')).toBeInTheDocument();
    expect(screen.queryByText('(352) 653-8188')).toBeNull();
  });
});

describe('incomplete member profiles', () => {
  it('blocks submission and explains why for a member with no phone on file', async () => {
    const user = userEvent.setup();
    renderPanel();

    await searchAndSelect(user, 'nophone', 'Nora Phone');

    expect(screen.getByText(/missing a valid phone number/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register Member' })).toBeDisabled();
    expect(createAdminRegistration).not.toHaveBeenCalled();
  });

  it('blocks submission with an admin-oriented message for an inactive account, instead of the server\'s reactivation error ever being reached', async () => {
    const user = userEvent.setup();
    renderPanel();

    await searchAndSelect(user, 'inactive', 'Ivy Inactive');

    expect(screen.getByText(/account is Inactive, not Active/)).toBeInTheDocument();
    expect(screen.getByText(/Reactivate them via User Controls/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register Member' })).toBeDisabled();
    expect(createAdminRegistration).not.toHaveBeenCalled();
  });

  it('does not block an archived member with the generic "Unknown" status, and names it Archived specifically', async () => {
    const user = userEvent.setup();
    renderPanel({
      users: [
        ...MEMBERS,
        {
          archivedDate: '2026-01-01',
          email: 'archived@example.com',
          firstName: 'Ann',
          id: 'user-5',
          lastName: 'Archived',
          phone: '9195559999',
          userId: 'user-5'
        }
      ]
    });

    await searchAndSelect(user, 'archived', 'Ann Archived');

    expect(screen.getByText(/account is Archived, not Active/)).toBeInTheDocument();
  });
});

describe('payment messaging by event type', () => {
  it('shows no payment required for a free event', async () => {
    const user = userEvent.setup();
    renderPanel({ event: FREE_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.getByText(/no payment is required/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register Member' })).not.toBeDisabled();
  });

  it('shows cash/check messaging with the cost for a paid, cash-check-enabled event', async () => {
    const user = userEvent.setup();
    renderPanel({ event: PAID_CASH_CHECK_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.getByText(/pay by cash or check later/)).toBeInTheDocument();
    expect(screen.getByText(/\$20\.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register Member' })).not.toBeDisabled();
  });

  // The server has the same guard independently (create-registration.js);
  // this is the client half that should mean it is never actually reached.
  it('disables the submit button and explains why for a paid event with no cash/check option', async () => {
    const user = userEvent.setup();
    renderPanel({ event: PAID_UNSUPPORTED_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.getByText(/does not support/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register Member' })).toBeDisabled();
  });
});

describe('admin cash/check override', () => {
  it('disables submit until the override checkbox is checked for an unsupported paid event', async () => {
    const user = userEvent.setup();
    renderPanel({ event: PAID_UNSUPPORTED_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    expect(screen.getByRole('button', { name: 'Register Member' })).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /Override/ }));

    expect(screen.getByRole('button', { name: 'Register Member' })).not.toBeDisabled();
    expect(screen.getByText(/pay by cash or check later/)).toBeInTheDocument();
  });

  it('sends allowCashCheckOverride and cash-check-later once the override is checked', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockResolvedValue({ registrationId: 'reg-1', status: 'Registered' });
    renderPanel({ event: PAID_UNSUPPORTED_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('checkbox', { name: /Override/ }));
    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    await waitFor(() => expect(createAdminRegistration).toHaveBeenCalledTimes(1));
    expect(createAdminRegistration.mock.calls[0][0]).toMatchObject({
      allowCashCheckOverride: true,
      paymentPreference: 'cash-check-later'
    });
  });

  it('does not offer the override for a free event or an already cash/check-supported paid event', async () => {
    const user = userEvent.setup();
    renderPanel({ event: PAID_CASH_CHECK_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.queryByRole('checkbox', { name: /Override/ })).toBeNull();
  });
});

describe('duplicate registration detection', () => {
  const EXISTING_REGISTRATION = { eventId: 'event-2', status: 'Registered', userId: 'user-1' };

  it('warns as soon as a member with an active registration is selected, before any submit attempt', async () => {
    const user = userEvent.setup();
    renderPanel({ event: PAID_CASH_CHECK_EVENT, existingRegistrations: [EXISTING_REGISTRATION] });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.getByText(/already has an active registration/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Register Member' })).toBeDisabled();
    expect(createAdminRegistration).not.toHaveBeenCalled();
  });

  it('does not warn when the member\'s only registration for this event was cancelled', async () => {
    const user = userEvent.setup();
    renderPanel({
      event: PAID_CASH_CHECK_EVENT,
      existingRegistrations: [{ ...EXISTING_REGISTRATION, status: 'Cancelled' }]
    });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.queryByText(/already has an active registration/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Register Member' })).not.toBeDisabled();
  });

  it('clears the warning once Change selects a different, unregistered member', async () => {
    const user = userEvent.setup();
    renderPanel({ event: PAID_CASH_CHECK_EVENT, existingRegistrations: [EXISTING_REGISTRATION] });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    expect(screen.getByText(/already has an active registration/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Change' }));
    await searchAndSelect(user, 'grace', 'Grace Hopper');

    expect(screen.queryByText(/already has an active registration/)).toBeNull();
  });
});

describe('event at capacity', () => {
  it('requires an explicit waitlist confirmation before submitting, not just inline copy', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockResolvedValue({ registrationId: 'reg-1', status: 'Waitlisted' });
    renderPanel({ event: FREE_EVENT, isFull: true });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    expect(screen.getByText(/cannot be given.*an active seat/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    // Blocked on a confirmation dialog - the server call has not happened yet.
    expect(createAdminRegistration).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Event Full - Add To Waitlist Instead?' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Add To Waitlist' }));

    await waitFor(() => expect(createAdminRegistration).toHaveBeenCalledTimes(1));
  });

  it('going back from the waitlist confirmation does not submit', async () => {
    const user = userEvent.setup();
    renderPanel({ event: FREE_EVENT, isFull: true });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: 'Register Member' }));
    await user.click(screen.getByRole('button', { name: 'Go Back' }));

    expect(createAdminRegistration).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Event Full - Add To Waitlist Instead?' })).toBeNull();
  });

  it('does not show full-event copy or the confirmation dialog when the event is not full', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockResolvedValue({ registrationId: 'reg-1', status: 'Registered' });
    renderPanel({ event: FREE_EVENT, isFull: false });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    expect(screen.queryByText(/cannot be given.*an active seat/)).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    await waitFor(() => expect(createAdminRegistration).toHaveBeenCalledTimes(1));
  });

  it('does not offer the payment-received prompt when the event is full', async () => {
    const user = userEvent.setup();
    renderPanel({ event: PAID_CASH_CHECK_EVENT, isFull: true });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.queryByText(/Payment was already received/)).toBeNull();
  });
});

describe('payment already received', () => {
  it('is not offered for a free event', async () => {
    const user = userEvent.setup();
    renderPanel({ event: FREE_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.queryByText(/Payment was already received/)).toBeNull();
  });

  it('requires a method once checked, disabling submit until one is picked', async () => {
    const user = userEvent.setup();
    renderPanel({ event: PAID_CASH_CHECK_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('checkbox', { name: /Payment was already received/ }));

    expect(screen.getByRole('button', { name: 'Register Member' })).toBeDisabled();

    await user.click(screen.getByRole('radio', { name: 'Cash' }));

    expect(screen.getByRole('button', { name: 'Register Member' })).not.toBeDisabled();
  });

  it('sends paymentReceived and the chosen method when checked', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockResolvedValue({ registrationId: 'reg-1', status: 'Registered' });
    renderPanel({ event: PAID_CASH_CHECK_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('checkbox', { name: /Payment was already received/ }));
    await user.click(screen.getByRole('radio', { name: 'Check' }));
    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    await waitFor(() => expect(createAdminRegistration).toHaveBeenCalledTimes(1));
    expect(createAdminRegistration.mock.calls[0][0]).toMatchObject({
      paymentReceived: true,
      paymentReceivedMethod: 'Check'
    });
  });

  it('does not send paymentReceived when left unchecked', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockResolvedValue({ registrationId: 'reg-1', status: 'Registered' });
    renderPanel({ event: PAID_CASH_CHECK_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    await waitFor(() => expect(createAdminRegistration).toHaveBeenCalledTimes(1));
    expect(createAdminRegistration.mock.calls[0][0]).toMatchObject({
      paymentReceived: false,
      paymentReceivedMethod: ''
    });
  });

  it('unchecking the box clears a previously chosen method', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockResolvedValue({ registrationId: 'reg-1', status: 'Registered' });
    renderPanel({ event: PAID_CASH_CHECK_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    const checkbox = screen.getByRole('checkbox', { name: /Payment was already received/ });
    await user.click(checkbox);
    await user.click(screen.getByRole('radio', { name: 'Cash' }));
    await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    await waitFor(() => expect(createAdminRegistration).toHaveBeenCalledTimes(1));
    expect(createAdminRegistration.mock.calls[0][0]).toMatchObject({
      paymentReceived: false,
      paymentReceivedMethod: ''
    });
  });
});

describe('submitting', () => {
  it('sends the expected payload and reports success without calling onClose directly, and never sends profileUpdates', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockResolvedValue({ registrationId: 'reg-1', status: 'Registered' });
    const { props } = renderPanel({ event: PAID_CASH_CHECK_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    await waitFor(() => expect(createAdminRegistration).toHaveBeenCalledTimes(1));

    const payload = createAdminRegistration.mock.calls[0][0];
    expect(payload).toMatchObject({
      email: 'ada@example.com',
      eventId: 'event-2',
      name: 'Ada Lovelace',
      paymentPreference: 'cash-check-later',
      phone: '3526538188',
      profileUserId: 'user-1'
    });
    expect(payload.profileUpdates).toBeUndefined();

    // The parent (RegistrationPanel), not this component, closes the modal -
    // it needs to show a success message first.
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onRegistered).toHaveBeenCalledWith({ registrationId: 'reg-1', status: 'Registered' });
  });

  it('sends an empty paymentPreference for a free event', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockResolvedValue({ registrationId: 'reg-1', status: 'Registered' });
    renderPanel({ event: FREE_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    await waitFor(() => expect(createAdminRegistration).toHaveBeenCalledTimes(1));
    expect(createAdminRegistration.mock.calls[0][0].paymentPreference).toBe('');
  });

  it('shows the server error and keeps the selected member on failure', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockRejectedValue(
      new Error('This account cannot register members on their behalf.')
    );
    const { props } = renderPanel();

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    await waitFor(() => {
      expect(screen.getByText('This account cannot register members on their behalf.')).toBeInTheDocument();
    });
    expect(props.onRegistered).not.toHaveBeenCalled();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });
});
