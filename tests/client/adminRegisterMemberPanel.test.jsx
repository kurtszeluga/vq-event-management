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
    billingAddress: { city: 'Loudon', country: 'United States', postalCode: '37774', state: 'TN', street: '12 Awohili Drive' },
    email: 'ada@example.com',
    firstName: 'Ada',
    id: 'user-1',
    lastName: 'Lovelace',
    phone: '3526538188',
    userId: 'user-1'
  },
  {
    email: 'grace@example.com',
    firstName: 'Grace',
    id: 'user-2',
    lastName: 'Hopper',
    phone: '9195551234',
    userId: 'user-2'
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
  it('prefills the registrant fields from the selected profile', async () => {
    const user = userEvent.setup();
    renderPanel();

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.getByLabelText('First Name *')).toHaveValue('Ada');
    expect(screen.getByLabelText('Last Name *')).toHaveValue('Lovelace');
    expect(screen.getByLabelText('Phone *')).toHaveValue('3526538188');
  });

  it('returns to search when Change is clicked, clearing the prefilled fields', async () => {
    const user = userEvent.setup();
    renderPanel();

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: 'Change' }));

    expect(screen.getByLabelText('Search Members')).toBeInTheDocument();
    expect(screen.queryByLabelText('First Name *')).toBeNull();
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

    await user.click(screen.getByRole('checkbox'));

    expect(screen.getByRole('button', { name: 'Register Member' })).not.toBeDisabled();
    expect(screen.getByText(/pay by cash or check later/)).toBeInTheDocument();
  });

  it('sends allowCashCheckOverride and cash-check-later once the override is checked', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockResolvedValue({ registrationId: 'reg-1', status: 'Registered' });
    renderPanel({ event: PAID_UNSUPPORTED_EVENT });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.click(screen.getByRole('checkbox'));
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

    expect(screen.queryByRole('checkbox')).toBeNull();
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
  it('labels the submit action as adding to the waitlist and still allows it', async () => {
    const user = userEvent.setup();
    createAdminRegistration.mockResolvedValue({ registrationId: 'reg-1', status: 'Waitlisted' });
    renderPanel({ event: FREE_EVENT, isFull: true });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.getByText(/will be added to the waitlist/)).toBeInTheDocument();
    const submitButton = screen.getByRole('button', { name: 'Add Member To Waitlist' });
    expect(submitButton).not.toBeDisabled();

    await user.click(submitButton);
    await waitFor(() => expect(createAdminRegistration).toHaveBeenCalledTimes(1));
  });

  it('keeps the ordinary label and copy when the event is not full', async () => {
    const user = userEvent.setup();
    renderPanel({ event: FREE_EVENT, isFull: false });

    await searchAndSelect(user, 'ada', 'Ada Lovelace');

    expect(screen.getByRole('button', { name: 'Register Member' })).toBeInTheDocument();
    expect(screen.queryByText(/will be added to the waitlist/)).toBeNull();
  });
});

describe('validation', () => {
  it('refuses to submit with an empty first name and does not call the server', async () => {
    const user = userEvent.setup();
    renderPanel();

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.clear(screen.getByLabelText('First Name *'));
    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    expect(screen.getByText('Please fix the highlighted fields.')).toBeInTheDocument();
    expect(createAdminRegistration).not.toHaveBeenCalled();
  });

  it('refuses a phone number with too few digits', async () => {
    const user = userEvent.setup();
    renderPanel();

    await searchAndSelect(user, 'ada', 'Ada Lovelace');
    await user.clear(screen.getByLabelText('Phone *'));
    await user.type(screen.getByLabelText('Phone *'), '123');
    await user.click(screen.getByRole('button', { name: 'Register Member' }));

    expect(screen.getByText('Please fix the highlighted fields.')).toBeInTheDocument();
    expect(createAdminRegistration).not.toHaveBeenCalled();
  });
});

describe('submitting', () => {
  it('sends the expected payload and reports success without calling onClose directly', async () => {
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
    expect(payload.profileUpdates).toMatchObject({ firstName: 'Ada', lastName: 'Lovelace' });

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
    expect(screen.getByLabelText('First Name *')).toHaveValue('Ada');
  });
});
