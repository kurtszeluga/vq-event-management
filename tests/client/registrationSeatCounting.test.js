import { describe, expect, it } from 'vitest';
import { holdsSeat } from '../../src/utils/registrationEligibility.js';
import { isEventFullForSeats } from '../../src/utils/registrationAvailability.js';

const FUTURE = new Date(Date.now() + 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

describe('holdsSeat', () => {
  it('counts the two statuses that occupy a seat', () => {
    expect(holdsSeat({ status: 'Registered' })).toBe(true);
    expect(holdsSeat({ status: 'Pending Payment' })).toBe(true);
  });

  it('counts a waitlisted registration only while its offer is live', () => {
    expect(holdsSeat({ status: 'Waitlisted', waitlistOfferExpiresAt: FUTURE })).toBe(true);
    expect(holdsSeat({ status: 'Waitlisted', waitlistOfferExpiresAt: PAST })).toBe(false);
    expect(holdsSeat({ status: 'Waitlisted' })).toBe(false);
  });

  it('counts nothing for a cancelled registration, or for nothing at all', () => {
    expect(holdsSeat({ status: 'Cancelled' })).toBe(false);
    expect(holdsSeat(null)).toBe(false);
  });

  // The whole reason this exists rather than summing the module's own
  // tallies: there, a Registered cash/check row awaiting collection is
  // counted as BOTH registered and pendingPayment, so adding them up reports
  // events full that are not. A status is a single value, so counting the
  // records once cannot double up.
  it('counts a registered cash/check row awaiting collection exactly once', () => {
    const registrations = [
      { paymentMethod: 'Check', paymentStatus: 'Pending', status: 'Registered' },
      { paymentMethod: 'Cash', paymentStatus: 'Pending', status: 'Registered' }
    ];

    expect(registrations.filter(holdsSeat).length).toBe(2);
    expect(isEventFullForSeats({ capacity: 4 }, registrations.filter(holdsSeat).length)).toBe(false);
  });
});

describe('isEventFullForSeats', () => {
  it('is full once the seats taken reach capacity', () => {
    expect(isEventFullForSeats({ capacity: 2 }, 1)).toBe(false);
    expect(isEventFullForSeats({ capacity: 2 }, 2)).toBe(true);
    expect(isEventFullForSeats({ capacity: 2 }, 3)).toBe(true);
  });

  it('is never full with unlimited capacity', () => {
    expect(isEventFullForSeats({ capacityUnlimited: true }, 999)).toBe(false);
  });

  // Capacity 0 reads as "not set" on the listing side rather than "no seats".
  it('treats an unset capacity as not full', () => {
    expect(isEventFullForSeats({ capacity: 0 }, 5)).toBe(false);
    expect(isEventFullForSeats({}, 5)).toBe(false);
  });
});
