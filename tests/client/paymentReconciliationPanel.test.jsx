import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateRegistrationPaymentMock = vi.fn();
const checkSquareRefundStatusMock = vi.fn();

vi.mock('../../src/services/registrationService.js', () => ({
  checkSquareRefundStatus: (...args) => checkSquareRefundStatusMock(...args),
  resolvePaymentReviewItem: vi.fn(),
  subscribeToRegistrations: (onSnapshot) => {
    onSnapshot({ docs: REGISTRATION_DOCS });
    return () => {};
  },
  subscribeToSquareWebhookEvents: (onSnapshot) => {
    onSnapshot({ docs: WEBHOOK_EVENT_DOCS });
    return () => {};
  },
  updateRegistrationPayment: (...args) => updateRegistrationPaymentMock(...args)
}));

let REGISTRATION_DOCS = [];
let WEBHOOK_EVENT_DOCS = [];

const { default: PaymentReconciliationPanel } = await import(
  '../../src/components/admin/PaymentReconciliationPanel.jsx'
);

function toDoc(registration) {
  return { id: registration.id, data: () => registration };
}

function renderPanel(registrations, webhookEvents = []) {
  REGISTRATION_DOCS = registrations.map(toDoc);
  WEBHOOK_EVENT_DOCS = webhookEvents.map(toDoc);
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

// The registration as production actually left it on 2026-11-19: cancelled,
// refund requested, Square never confirmed, and the review row marked Reviewed
// by hand - which did nothing to the registration.
const REFUND_PENDING_REGISTRATION = {
  amountPaid: 11,
  eventTitle: 'TESTING - 2027 Annual Guild Membership',
  id: 'reg-refund',
  name: 'Test Member',
  paymentMethod: 'Online',
  paymentStatus: 'Refund Pending',
  status: 'Cancelled'
};

const REVIEWED_REFUND_ITEM = {
  eventTitle: 'TESTING - 2027 Annual Guild Membership',
  id: 'refund-pending-abc',
  reconciliationStatus: 'Reviewed',
  registrationEmail: 'member@example.com',
  registrationId: 'reg-refund',
  registrationName: 'Test Member',
  status: 'Reviewed'
};

beforeEach(() => {
  updateRegistrationPaymentMock.mockReset();
  checkSquareRefundStatusMock.mockReset();
  WEBHOOK_EVENT_DOCS = [];
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

  it('includes a Registered, unpaid registration even when paymentPreference is blank or missing', () => {
    // A confirmed (Registered) paid-event registration only ever lands in
    // Pending payment status via the cash/check path - but older records
    // (created before paymentPreference existed, or one an admin reset to
    // Pending via the Edit Registration form) can have it blank. Requiring
    // it here previously hid exactly these from review - the real bug
    // report this section exists to catch.
    renderPanel([{ ...AWAITING_COLLECTION, paymentPreference: '' }]);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();

    cleanup();
    const { paymentPreference: _paymentPreference, ...withoutPreference } = AWAITING_COLLECTION;
    renderPanel([withoutPreference]);
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
  });

  it('requires a Cash or Check choice before Mark Paid can be used', async () => {
    const user = userEvent.setup();
    renderPanel([AWAITING_COLLECTION]);

    await user.click(screen.getByRole('button', { name: 'Mark Paid' }));

    expect(screen.getByText(/Choose Cash or Check/)).toBeInTheDocument();
    expect(updateRegistrationPaymentMock).not.toHaveBeenCalled();
  });

  it('requires confirmation before actually marking the payment received', async () => {
    const user = userEvent.setup();
    renderPanel([AWAITING_COLLECTION]);

    await user.click(screen.getByRole('radio', { name: 'Check' }));
    await user.click(screen.getByRole('button', { name: 'Mark Paid' }));

    expect(screen.getByRole('heading', { name: 'Mark Payment Received?' })).toBeInTheDocument();
    expect(screen.getByText(/Mark \$20\.00 from Ada Lovelace/)).toBeInTheDocument();
    expect(updateRegistrationPaymentMock).not.toHaveBeenCalled();
  });

  it('does not call the server when the confirmation is cancelled', async () => {
    const user = userEvent.setup();
    renderPanel([AWAITING_COLLECTION]);

    await user.click(screen.getByRole('radio', { name: 'Check' }));
    await user.click(screen.getByRole('button', { name: 'Mark Paid' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('heading', { name: 'Mark Payment Received?' })).toBeNull();
    expect(updateRegistrationPaymentMock).not.toHaveBeenCalled();
  });

  it('marks a registration paid with the full amount due and the chosen method once confirmed', async () => {
    const user = userEvent.setup();
    updateRegistrationPaymentMock.mockResolvedValue({});
    renderPanel([AWAITING_COLLECTION]);

    await user.click(screen.getByRole('radio', { name: 'Check' }));
    await user.click(screen.getByRole('button', { name: 'Mark Paid' }));
    await user.click(screen.getByRole('button', { name: 'Confirm Payment Received' }));

    await waitFor(() => expect(updateRegistrationPaymentMock).toHaveBeenCalledTimes(1));
    expect(updateRegistrationPaymentMock).toHaveBeenCalledWith('reg-1', expect.objectContaining({
      amountPaid: 20,
      paymentMethod: 'Check',
      paymentStatus: 'Paid'
    }));
    expect(await screen.findByText(/Marked Ada Lovelace paid/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Mark Payment Received?' })).toBeNull();
  });
});

describe('checking a pending refund with Square', () => {
  it('offers the check even on a review item already marked Reviewed', async () => {
    // This is the case that matters: clearing the review item never resolved
    // the registration, so keying the button off the review row's label would
    // have hidden it on the only refund that needed it.
    renderPanel([REFUND_PENDING_REGISTRATION], [REVIEWED_REFUND_ITEM]);

    await userEvent.click(screen.getByRole('button', { name: /^All \(/ }));

    expect(screen.getByRole('button', { name: 'Check With Square' })).toBeInTheDocument();
  });

  it('reports what Square said, pending included', async () => {
    checkSquareRefundStatusMock.mockResolvedValue({
      message: 'Square still has this refund as pending.',
      outcome: 'pending'
    });
    renderPanel([REFUND_PENDING_REGISTRATION], [REVIEWED_REFUND_ITEM]);

    await userEvent.click(screen.getByRole('button', { name: /^All \(/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Check With Square' }));

    expect(checkSquareRefundStatusMock).toHaveBeenCalledWith('reg-refund');
    await waitFor(() => {
      expect(screen.getByText('Square still has this refund as pending.')).toBeInTheDocument();
    });
  });

  it('surfaces a failure to reach Square as an error', async () => {
    checkSquareRefundStatusMock.mockRejectedValue(new Error('Square is unavailable.'));
    renderPanel([REFUND_PENDING_REGISTRATION], [REVIEWED_REFUND_ITEM]);

    await userEvent.click(screen.getByRole('button', { name: /^All \(/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Check With Square' }));

    await waitFor(() => {
      expect(screen.getByText('Square is unavailable.')).toBeInTheDocument();
    });
  });

  it('drops the check once the registration is no longer awaiting a refund', async () => {
    renderPanel(
      [{ ...REFUND_PENDING_REGISTRATION, paymentStatus: 'Refunded' }],
      [{ ...REVIEWED_REFUND_ITEM, reconciliationStatus: 'Refund Completed' }]
    );

    await userEvent.click(screen.getByRole('button', { name: /^All \(/ }));

    expect(screen.queryByRole('button', { name: 'Check With Square' })).toBeNull();
  });
});

// Reported 2026-11-21: issuing a refund put a "payment needs review" on the
// dashboard straight away, and then asked for a resolution note on something
// that needed no resolution. A refund Square accepts as PENDING is the
// ordinary path, so its row is now written unflagged and only the daily sweep
// promotes it if the refund has still not completed.
describe('a refund that is simply waiting on Square', () => {
  const AWAITING_SQUARE_ITEM = {
    eventTitle: 'December Workshop',
    id: 'refund-pending-xyz',
    reconciliationStatus: 'Refund Pending',
    registrationEmail: 'member@example.com',
    registrationId: 'reg-refund',
    registrationName: 'Ada Lovelace',
    status: 'Processed'
  };

  it('is not counted as needing review', () => {
    renderPanel([], [AWAITING_SQUARE_ITEM]);

    // The panel opens on Needs Review, so an empty list here is the whole
    // point: nothing is asking the admin for anything.
    const needsReview = screen.getByRole('button', { name: /Needs Review/ });

    expect(needsReview.textContent).toMatch(/\b0\b/);
  });

  it('is still reachable, under Awaiting Square', async () => {
    // Without a bucket of its own an unflagged row would be findable only
    // under All - in flight and invisible.
    const user = userEvent.setup();
    renderPanel([], [AWAITING_SQUARE_ITEM]);

    await user.click(screen.getByRole('button', { name: /Awaiting Square/ }));

    await waitFor(() => {
      expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    });
  });

  it('shows the refund comment, so the row explains itself', async () => {
    // The point of carrying it: whoever opens this should not have to go
    // looking for why the money went back.
    const user = userEvent.setup();
    renderPanel([], [{
      ...AWAITING_SQUARE_ITEM,
      reviewDetails: {
        message: 'Square accepted the refund request and is completing it.',
        refundComment: 'Member cancelled, family emergency.'
      }
    }]);

    await user.click(screen.getByRole('button', { name: /Awaiting Square/ }));

    await waitFor(() => {
      expect(screen.getByText(/Refund Comment: Member cancelled, family emergency\./))
        .toBeInTheDocument();
    });
  });

  it('counts as needing review once the sweep has flagged it', () => {
    renderPanel([], [{ ...AWAITING_SQUARE_ITEM, reconciliationStatus: 'Refund Needs Review' }]);

    const needsReview = screen.getByRole('button', { name: /Needs Review/ });

    expect(needsReview.textContent).toMatch(/\b1\b/);
  });
});
