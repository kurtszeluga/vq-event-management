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

const { getListingEndDefault, stampNowDates } = await import('../../src/components/admin/EventForm.jsx');

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

describe('the listing end default', () => {
  const EVENT_DAY = '2099-12-11';

  it('comes down at 9 a.m. on the day of the event', () => {
    // Asked for on 2026-11-21: the guild takes registrations nearly up to the
    // day, so a listing told to appear Now should come down that morning
    // rather than having no stated end at all.
    const result = stampNowDates({
      date: EVENT_DAY,
      eventType: 'Class (Full Day)',
      listingMode: 'now',
      registrationMode: 'none',
      visibleFrom: '',
      visibleUntil: ''
    });

    expect(result.visibleUntil).toBe(`${EVENT_DAY}T09:00`);
  });

  it('leaves a Remove Listing date the admin typed alone', () => {
    const result = stampNowDates({
      date: EVENT_DAY,
      eventType: 'Class (Full Day)',
      listingMode: 'now',
      registrationMode: 'none',
      visibleFrom: FUTURE,
      visibleUntil: '2099-12-01T17:00'
    });

    expect(result.visibleUntil).toBe('2099-12-01T17:00');
  });

  it('invents nothing for a type with no event date', () => {
    // Challenges and Membership collect no date, and the two listing types
    // carry their own expiry - For Sale is six months out, a Business
    // Listing is open-ended.
    for (const eventType of ['Challenges', 'Membership', 'For Sale', 'Business Listing']) {
      expect(getListingEndDefault({ date: '', eventType })).toBe('');
    }

    // Even with a date on it, a challenge keeps its own midnight window.
    expect(getListingEndDefault({ date: EVENT_DAY, eventType: 'Challenges' })).toBe('');
  });

  it('pulls a defaulted registration close date back to the listing end', () => {
    // A full-day class closes registration at its 9:30 start by default,
    // which is AFTER the 9 a.m. listing end - and validateEventForm refuses
    // that pair, because isEventVisible() gates registration as well as
    // listing. Without this the form would refuse its own suggestion.
    const result = stampNowDates(
      {
        date: EVENT_DAY,
        eventType: 'Class (Full Day)',
        listingMode: 'now',
        registrationMode: 'now',
        registrationCloseAt: `${EVENT_DAY}T09:30`,
        visibleFrom: '',
        visibleUntil: ''
      },
      { defaultCloseAt: `${EVENT_DAY}T09:30` }
    );

    expect(result.visibleUntil).toBe(`${EVENT_DAY}T09:00`);
    expect(result.registrationCloseAt).toBe(`${EVENT_DAY}T09:00`);
  });

  it('leaves a close date the admin typed for the validation to refuse', () => {
    // The existing rule in this file: a deliberate choice is refused rather
    // than silently rewritten.
    const result = stampNowDates(
      {
        date: EVENT_DAY,
        eventType: 'Class (Full Day)',
        listingMode: 'now',
        registrationMode: 'now',
        registrationCloseAt: `${EVENT_DAY}T16:30`,
        visibleFrom: '',
        visibleUntil: ''
      },
      { defaultCloseAt: `${EVENT_DAY}T09:30` }
    );

    expect(result.registrationCloseAt).toBe(`${EVENT_DAY}T16:30`);
  });
});
