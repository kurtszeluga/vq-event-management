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

describe('supportsSupplyList', () => {
  it('supports Class (both durations), Workshop, and Other', () => {
    expect(supportsSupplyList('Class (Half Day)')).toBe(true);
    expect(supportsSupplyList('Class (Full Day)')).toBe(true);
    expect(supportsSupplyList('Workshop')).toBe(true);
    expect(supportsSupplyList('Other')).toBe(true);
  });

  it('does not support Retreat, Lecture, Business Listing, or For Sale', () => {
    expect(supportsSupplyList('Retreat')).toBe(false);
    expect(supportsSupplyList('Lecture')).toBe(false);
    expect(supportsSupplyList('Business Listing')).toBe(false);
    expect(supportsSupplyList('For Sale')).toBe(false);
  });

  it('Challenges is false here - it gets its own separate Challenge PDF field instead', () => {
    expect(supportsSupplyList('Challenges')).toBe(false);
  });
});

describe('buildEventPayload supply list field for Other events', () => {
  it('keeps the supply list fields when Other has one uploaded', () => {
    const form = {
      ...DEFAULT_EVENT_FORM,
      eventType: 'Other',
      supplyListFileName: 'stuff.pdf',
      supplyListTitle: 'Supply List',
      supplyListUrl: 'https://example.com/stuff.pdf'
    };

    const payload = buildEventPayload(form, supportsSupplyList(form.eventType), false);

    expect(payload.supplyListUrl).toBe('https://example.com/stuff.pdf');
    expect(payload.supplyListTitle).toBe('Supply List');
    expect(payload.supplyListFileName).toBe('stuff.pdf');
  });

  it('strips the supply list fields for an event type that does not support it', () => {
    const form = {
      ...DEFAULT_EVENT_FORM,
      eventType: 'Retreat',
      supplyListFileName: 'stuff.pdf',
      supplyListTitle: 'Supply List',
      supplyListUrl: 'https://example.com/stuff.pdf'
    };

    const payload = buildEventPayload(form, supportsSupplyList(form.eventType), false);

    expect(payload.supplyListUrl).toBe('');
    expect(payload.supplyListTitle).toBe('');
    expect(payload.supplyListFileName).toBe('');
  });
});
