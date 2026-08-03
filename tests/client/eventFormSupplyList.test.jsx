import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));
vi.mock('../../src/services/eventService.js', () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn()
}));
vi.mock('../../src/services/storageService.js', () => ({
  deleteEventFile: vi.fn(),
  uploadEventImage: vi.fn(),
  uploadEventPdf: vi.fn()
}));

const { DEFAULT_EVENT_FORM } = await import('../../src/data/eventOptions.js');
const { buildEventPayload, supportsSupplyList } = await import('../../src/components/admin/EventForm.jsx');

const { EVENT_TYPES } = await import('../../src/data/eventOptions.js');
const { LISTING_EVENT_TYPES } = await import('../../shared/eventListing.js');

describe('supportsSupplyList', () => {
  it('supports every event type that is not a listing', () => {
    const registerableTypes = EVENT_TYPES.filter((type) => !LISTING_EVENT_TYPES.includes(type));

    // Asserted against EVENT_TYPES rather than a hand-written list so a type
    // added later is covered here the moment it is added, which is exactly
    // what the previous allow-list implementation kept getting wrong.
    expect(registerableTypes.length).toBeGreaterThan(0);
    registerableTypes.forEach((type) => {
      expect(supportsSupplyList(type)).toBe(true);
    });
  });

  it('covers the types that previously had no upload at all', () => {
    expect(supportsSupplyList('Retreat')).toBe(true);
    expect(supportsSupplyList('Lecture')).toBe(true);
    // Challenges reached the field only through an `|| isChallenge` escape
    // hatch at each call site; the predicate answers for it directly now.
    expect(supportsSupplyList('Challenges')).toBe(true);
  });

  it('does not support Business Listing or For Sale', () => {
    LISTING_EVENT_TYPES.forEach((type) => {
      expect(supportsSupplyList(type)).toBe(false);
    });
  });

  it('does not throw on a missing or empty event type', () => {
    expect(supportsSupplyList('')).toBe(false);
    expect(supportsSupplyList(undefined)).toBe(false);
  });
});

describe('buildEventPayload supply list fields', () => {
  const formWith = (eventType) => ({
    ...DEFAULT_EVENT_FORM,
    eventType,
    supplyListFileName: 'stuff.pdf',
    supplyListTitle: 'Supply List',
    supplyListUrl: 'https://example.com/stuff.pdf'
  });

  it('keeps the supply list fields for a type that supports one', () => {
    const form = formWith('Other');
    const payload = buildEventPayload(form, supportsSupplyList(form.eventType), false);

    expect(payload.supplyListUrl).toBe('https://example.com/stuff.pdf');
    expect(payload.supplyListTitle).toBe('Supply List');
    expect(payload.supplyListFileName).toBe('stuff.pdf');
  });

  it('keeps them for Retreat, which could not carry one before', () => {
    const form = formWith('Retreat');
    const payload = buildEventPayload(form, supportsSupplyList(form.eventType), false);

    expect(payload.supplyListUrl).toBe('https://example.com/stuff.pdf');
    expect(payload.supplyListTitle).toBe('Supply List');
    expect(payload.supplyListFileName).toBe('stuff.pdf');
  });

  it('strips them for a listing type', () => {
    const form = formWith('For Sale');
    const payload = buildEventPayload(form, supportsSupplyList(form.eventType), false);

    expect(payload.supplyListUrl).toBe('');
    expect(payload.supplyListTitle).toBe('');
    expect(payload.supplyListFileName).toBe('');
  });
});
