import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The claim page used to offer exactly one action: take the seat. A member who
// did not want it could only ignore the email, which ties the seat up for the
// whole claim window plus however long the daily sweep takes to come round.

const claimWaitlistOffer = vi.fn();
const declineWaitlistOffer = vi.fn();

vi.mock('../../src/services/registrationService.js', () => ({
  claimWaitlistOffer: (...args) => claimWaitlistOffer(...args),
  declineWaitlistOffer: (...args) => declineWaitlistOffer(...args),
  loadSquarePaymentConfig: () => Promise.resolve({})
}));
vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));

const { default: WaitlistClaimPage } = await import('../../src/pages/WaitlistClaimPage.jsx');

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/waitlist-claim?registrationId=r1&token=tok']}>
      <WaitlistClaimPage />
    </MemoryRouter>
  );
}

describe('declining a waitlist offer', () => {
  beforeEach(() => {
    claimWaitlistOffer.mockReset();
    declineWaitlistOffer.mockReset();
    // The bare page load "peek": reveals what is owed, claims nothing.
    claimWaitlistOffer.mockResolvedValue({
      amountDue: 0,
      claimed: false,
      eventTitle: 'Curved Seams',
      paymentRequired: false
    });
    declineWaitlistOffer.mockResolvedValue({ declined: true });
  });

  afterEach(cleanup);

  it('asks before giving the seat up, and says what it costs', async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText(/Confirm My Spot/);
    await user.click(screen.getByRole('button', { name: /No Thanks/i }));

    expect(await screen.findByText('Give Up This Spot?')).toBeTruthy();
    // The consequence that is not obvious: this is not just "not now".
    expect(screen.getByText(/takes you off the list/i)).toBeTruthy();
    expect(declineWaitlistOffer).not.toHaveBeenCalled();
  });

  it('declines with the link token once confirmed', async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText(/Confirm My Spot/);
    await user.click(screen.getByRole('button', { name: /No Thanks/i }));
    await user.click(await screen.findByRole('button', { name: 'Yes, Give It Up' }));

    await waitFor(() => expect(declineWaitlistOffer).toHaveBeenCalledWith({
      registrationId: 'r1',
      token: 'tok'
    }));
    expect(await screen.findByText(/Thanks For Letting Us Know/)).toBeTruthy();
  });

  it('backing out leaves the offer alone', async () => {
    const user = userEvent.setup();

    renderPage();
    await screen.findByText(/Confirm My Spot/);
    await user.click(screen.getByRole('button', { name: /No Thanks/i }));
    await user.click(await screen.findByRole('button', { name: 'Keep My Offer' }));

    await waitFor(() => expect(screen.queryByText('Give Up This Spot?')).toBeNull());
    expect(declineWaitlistOffer).not.toHaveBeenCalled();
    expect(screen.getByText(/Confirm My Spot/)).toBeTruthy();
  });

  it('keeps the dialog open with the reason when the decline fails', async () => {
    const user = userEvent.setup();

    declineWaitlistOffer.mockRejectedValue(new Error('This offer is no longer available.'));
    renderPage();
    await screen.findByText(/Confirm My Spot/);
    await user.click(screen.getByRole('button', { name: /No Thanks/i }));
    await user.click(await screen.findByRole('button', { name: 'Yes, Give It Up' }));

    expect(await screen.findByText('This offer is no longer available.')).toBeTruthy();
    // Still open, rather than closing on someone with no idea what happened.
    expect(screen.getByText('Give Up This Spot?')).toBeTruthy();
  });
});
