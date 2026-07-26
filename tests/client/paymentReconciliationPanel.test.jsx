import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateRegistrationPaymentMock = vi.fn();

vi.mock('../../src/services/registrationService.js', () => ({
  resolvePaymentReviewItem: vi.fn(),
  subscribeToRegistrations: (onSnapshot) => {
    onSnapshot({ docs: REGISTRATION_DOCS });
    return () => {};
  },
  subscribeToSquareWebhookEvents: (onSnapshot) => {
    onSnapshot({ docs: [] });
    return () => {};
  },
  updateRegistrationPayment: (...args) => updateRegistrationPaymentMock(...args)
}));

let REGISTRATION_DOCS = [];

const { default: PaymentReconciliationPanel } = await import(
  '../../src/components/admin/PaymentReconciliationPanel.jsx'
);

function toDoc(registration) {
  return { id: registration.id, data: () => registration };
}

function renderPanel(registrations) {
  REGISTRATION_DOCS = registrations.map(toDoc);
  return render(<PaymentReconciliationPanel />);
}

const AWAITING_COLLECTION = {
  amountDue: 20,
  eventTitle: 'Retreat',
  id: 'reg-1',
  name: 'Ada Lovelace',
  paymentPreference: 'cash-check-later',
  paymentStatus: 'Pending',
  registrationDate: '2026-07-20T00:00:00.000Z',
  status: 'Registered'
};

beforeEach(() => {
  updateRegistrationPaymentMock.mockReset();
});

afterEach(cleanup);

describe('cash/check awaiting collection', () => {
  it('lists a registered, unpaid, cash/check-preference registration', () => {
    renderPanel([AWAITING_COLLECTION]);

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Retreat')).toBeInTheDocument();
    expect(screen.getByText('$20.00')).toBeInTheDocument();
  });

  it('excludes a waitlisted registration - no seat is held yet to collect payment for', () => {
    renderPanel([{ ...AWAITING_COLLECTION, status: 'Waitlisted' }]);

    expect(screen.queryByText('Ada Lovelace')).toBeNull();
    expect(screen.getByText('Nothing awaiting collection')).toBeInTheDocument();
  });

  it('excludes a registration already marked paid', () => {
    renderPanel([{ ...AWAITING_COLLECTION, paymentStatus: 'Paid' }]);

    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  it('excludes a registration that never chose cash/check (e.g. an online Square payment)', () => {
    renderPanel([{ ...AWAITING_COLLECTION, paymentPreference: '' }]);

    expect(screen.queryByText('Ada Lovelace')).toBeNull();
  });

  it('requires a Cash or Check choice before Mark Paid can be used', async () => {
    const user = userEvent.setup();
    renderPanel([AWAITING_COLLECTION]);

    await user.click(screen.getByRole('button', { name: 'Mark Paid' }));

    expect(screen.getByText(/Choose Cash or Check/)).toBeInTheDocument();
    expect(updateRegistrationPaymentMock).not.toHaveBeenCalled();
  });

  it('marks a registration paid with the full amount due and the chosen method', async () => {
    const user = userEvent.setup();
    updateRegistrationPaymentMock.mockResolvedValue({});
    renderPanel([AWAITING_COLLECTION]);

    await user.click(screen.getByRole('radio', { name: 'Check' }));
    await user.click(screen.getByRole('button', { name: 'Mark Paid' }));

    await waitFor(() => expect(updateRegistrationPaymentMock).toHaveBeenCalledTimes(1));
    expect(updateRegistrationPaymentMock).toHaveBeenCalledWith('reg-1', expect.objectContaining({
      amountPaid: 20,
      paymentMethod: 'Check',
      paymentStatus: 'Paid'
    }));
    expect(await screen.findByText(/Marked Ada Lovelace paid/)).toBeInTheDocument();
  });
});
