import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SeatHoldStatus from '../../src/components/SeatHoldStatus.jsx';

afterEach(cleanup);

const expiredHold = { expiresAt: new Date(Date.now() - 1000).toISOString() };
const liveHold = { expiresAt: new Date(Date.now() + 600000).toISOString() };

describe('a seat hold running out while the member is idle', () => {
  it('tells the caller once, not once a second', async () => {
    // The countdown re-checks every second. onExpired now carries the whole
    // consequence of expiry, so firing it repeatedly would re-run it for as
    // long as the member leaves the page open.
    const onExpired = vi.fn();

    render(<SeatHoldStatus onExpired={onExpired} reservation={expiredHold} />);

    await waitFor(() => expect(onExpired).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(onExpired).toHaveBeenCalledTimes(1);
  });

  // The member stays on the page now, so this line is the whole explanation
  // they get. It used to say "Returning you to the listing", which described
  // what the page did to them 1.5 seconds later - and is now simply untrue.
  it('does not promise to move the member anywhere', async () => {
    render(<SeatHoldStatus onExpired={() => {}} reservation={expiredHold} />);

    await waitFor(() => expect(screen.getByText(/expired/i)).toBeInTheDocument());

    const message = screen.getByText(/expired/i).textContent;

    expect(message).not.toMatch(/return/i);
    expect(message).not.toMatch(/listing/i);
    expect(message).toMatch(/start registration again/i);
  });

  // Membership passes seatsUnlimited, which deliberately hides the countdown -
  // a signup that cannot run out of seats should not show a deadline. But the
  // hold underneath still expires and still stops the form, so suppressing
  // the failure too would leave the member with a page that quietly stopped
  // working and said nothing about it.
  it('still reports the failure on a signup with unlimited seats', () => {
    render(
      <SeatHoldStatus
        onExpired={() => {}}
        reservation={null}
        reservationError="Your seat hold expired. Start registration again."
        seatsUnlimited
      />
    );

    expect(screen.getByText(/seat hold expired/i)).toBeInTheDocument();
  });

  // The deadline is real on an unlimited-seat signup too - the hold runs out
  // and the form stops - so it is shown. What changes is what it is called:
  // there is no seat to lose, and describing it as one invents a competition
  // that is not happening.
  it('shows the time left to pay when seats are unlimited', () => {
    render(<SeatHoldStatus onExpired={() => {}} reservation={liveHold} seatsUnlimited />);

    const message = screen.getByText(/you have/i).textContent;

    expect(message).toMatch(/to complete your payment/i);
    expect(message).toMatch(/\d+:\d{2}/);
    expect(message).not.toMatch(/seat/i);
  });

  it('still calls a held seat a held seat everywhere else', () => {
    render(<SeatHoldStatus onExpired={() => {}} reservation={liveHold} />);

    expect(screen.getByText(/your seat is held for \d+:\d{2}/i)).toBeInTheDocument();
  });

  // The countdown is the only warning the member gets, and it was previously
  // suppressed here entirely - so a Membership signup ran out of time with
  // nothing on screen having said it was running.
  it('never leaves an unlimited-seat signup with no deadline on screen', () => {
    const { container } = render(
      <SeatHoldStatus onExpired={() => {}} reservation={liveHold} seatsUnlimited />
    );

    expect(container.textContent.trim()).not.toBe('');
  });
});
