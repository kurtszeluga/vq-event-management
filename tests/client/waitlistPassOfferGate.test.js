import { describe, expect, it } from 'vitest';
import { hasOutstandingWaitlistOffer } from '../../src/utils/registrationEligibility.js';

// Pass To Next drops someone off the waitlist, so the control must not appear
// where there is no offer outstanding to pass on.
describe('the Pass To Next gate', () => {
  it('is open only while an offer is actually outstanding', () => {
    expect(hasOutstandingWaitlistOffer({
      status: 'Waitlisted',
      waitlistOfferExpiresAt: new Date(Date.now() + 60_000).toISOString()
    })).toBe(true);
  });

  it('accepts a Firestore timestamp as well as an ISO string', () => {
    expect(hasOutstandingWaitlistOffer({
      status: 'Waitlisted',
      waitlistOfferExpiresAt: { toDate: () => new Date(Date.now() + 60_000) }
    })).toBe(true);
  });

  it('is shut for a waitlisted member who was never offered a seat', () => {
    expect(hasOutstandingWaitlistOffer({ status: 'Waitlisted' })).toBe(false);
  });

  it('is shut once the offer has lapsed', () => {
    expect(hasOutstandingWaitlistOffer({
      status: 'Waitlisted',
      waitlistOfferExpiresAt: new Date(Date.now() - 60_000).toISOString()
    })).toBe(false);
  });

  it('is shut for anyone not on the waitlist, and for nothing at all', () => {
    expect(hasOutstandingWaitlistOffer({
      status: 'Registered',
      waitlistOfferExpiresAt: new Date(Date.now() + 60_000).toISOString()
    })).toBe(false);
    expect(hasOutstandingWaitlistOffer(null)).toBe(false);
  });
});
