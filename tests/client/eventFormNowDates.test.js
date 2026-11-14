import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));
vi.mock('../../src/services/eventService.js', () => ({ createEvent: vi.fn(), updateEvent: vi.fn() }));
vi.mock('../../src/services/storageService.js', () => ({
  deleteEventFile: vi.fn(),
  uploadEventImage: vi.fn(),
  uploadEventPdf: vi.fn()
}));
vi.mock('../../src/services/configurationService.js', () => ({
  subscribeToActiveBusinessTypeDefaults: () => () => {},
  subscribeToActiveEventLocationDefaults: () => () => {},
  subscribeToActiveEventTimeDefaults: () => () => {},
  subscribeToPaymentSettings: () => () => {}
}));

const { stampNowDates } = await import('../../src/components/admin/EventForm.jsx');

const today = new Date().toISOString().slice(0, 10);
const FUTURE = '2099-11-30T09:00';

describe('stampNowDates', () => {
  it('writes today onto the listing date when the listing is set to Now', () => {
    // The bug this fixes: the Post Listing input is not rendered for Now, so
    // switching back from In The Future left the old future date in the
    // document and the event stayed invisible until it arrived.
    const result = stampNowDates({
      listingMode: 'now',
      registrationMode: 'none',
      visibleFrom: FUTURE
    });

    expect(result.visibleFrom.slice(0, 10)).toBe(today);
  });

  it('writes today onto the registration-open date when registration is Now', () => {
    const result = stampNowDates({
      listingMode: 'now',
      registrationMode: 'now',
      registrationOpenAt: FUTURE,
      visibleFrom: FUTURE
    });

    expect(result.registrationOpenAt.slice(0, 10)).toBe(today);
  });

  it('clears the stale registration date left by a future listing', () => {
    // The combination reported: listed in the future with registration Now,
    // then switched to list Now. Both dates have to come back to today, or the
    // event claims to be open while refusing every attempt.
    const result = stampNowDates({
      listingMode: 'now',
      registrationMode: 'now',
      registrationOpenAt: FUTURE,
      visibleFrom: FUTURE
    });

    expect(result.visibleFrom.slice(0, 10)).toBe(today);
    expect(result.registrationOpenAt.slice(0, 10)).toBe(today);
  });

  it('leaves a future listing alone', () => {
    const result = stampNowDates({
      listingMode: 'future',
      registrationMode: 'future',
      registrationOpenAt: FUTURE,
      visibleFrom: FUTURE
    });

    expect(result.visibleFrom).toBe(FUTURE);
    expect(result.registrationOpenAt).toBe(FUTURE);
  });

  it('still holds registration open to the listing date when listing is later', () => {
    // Registration Now under a future listing means "opens when it is listed",
    // not today - otherwise the save would refuse its own default.
    const result = stampNowDates({
      listingMode: 'future',
      registrationMode: 'now',
      registrationOpenAt: '',
      visibleFrom: FUTURE
    });

    expect(result.registrationOpenAt).toBe(FUTURE);
  });

  it('does not invent a registration date for an event that takes none', () => {
    const result = stampNowDates({
      listingMode: 'now',
      registrationMode: 'none',
      registrationOpenAt: '',
      visibleFrom: ''
    });

    expect(result.registrationOpenAt).toBe('');
  });
});
