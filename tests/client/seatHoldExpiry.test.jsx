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

  it('says nothing at all while the hold is still good and seats are unlimited', () => {
    const { container } = render(
      <SeatHoldStatus onExpired={() => {}} reservation={liveHold} seatsUnlimited />
    );

    expect(container.textContent).toBe('');
  });
});
