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
const { formatEventDateRange } = await import('../../src/utils/eventFormat.js');
const { buildEventPayload, validateEventForm } = await import(
  '../../src/components/admin/EventForm.jsx'
);

describe('formatEventDateRange', () => {
  it('formats a single day when there is no end date', () => {
    expect(formatEventDateRange({ date: '2026-10-02' })).toBe('10/02/2026');
  });

  it('formats a span when the end date differs', () => {
    expect(formatEventDateRange({ date: '2026-10-02', endDate: '2026-10-04' }))
      .toBe('10/02/2026 - 10/04/2026');
  });

  it('collapses a same-day span rather than repeating the date', () => {
    expect(formatEventDateRange({ date: '2026-10-02', endDate: '2026-10-02' }))
      .toBe('10/02/2026');
  });

  it('falls back to the TBD text when neither date is set', () => {
    expect(formatEventDateRange({})).toBe('Date TBD');
    expect(formatEventDateRange(undefined)).toBe('Date TBD');
  });

  // The whole reason this file formats dates as text instead of through Date:
  // an ISO date-only string is UTC midnight, which lands a day early anywhere
  // behind UTC.
  it('does not shift a date by a day', () => {
    expect(formatEventDateRange({ date: '2026-01-01', endDate: '2026-12-31' }))
      .toBe('01/01/2026 - 12/31/2026');
  });
});

describe('retreat end date', () => {
  const retreatForm = (overrides) => ({
    ...DEFAULT_EVENT_FORM,
    eventType: 'Retreat',
    date: '2026-10-02',
    endDate: '2026-10-04',
    startTime: '16:00',
    endTime: '14:00',
    capacity: '20',
    isPaid: false,
    registrationMode: 'none',
    location: 'Lake House',
    title: 'Autumn Retreat',
    ...overrides
  });

  it('requires an end date', () => {
    expect(validateEventForm(retreatForm({ endDate: '' })).endDate)
      .toBe('End date is required.');
  });

  it('rejects an end date before the start date', () => {
    expect(validateEventForm(retreatForm({ endDate: '2026-10-01' })).endDate)
      .toBe('End date cannot be before the start date.');
  });

  it('accepts an end date on the same day as the start', () => {
    expect(validateEventForm(retreatForm({ endDate: '2026-10-02' })).endDate)
      .toBeUndefined();
  });

  it('accepts a valid span', () => {
    expect(validateEventForm(retreatForm()).endDate).toBeUndefined();
  });

  it('does not require an end date for a non-retreat type', () => {
    const form = { ...retreatForm(), eventType: 'Workshop', endDate: '' };

    expect(validateEventForm(form).endDate).toBeUndefined();
  });

  it('carries the end date into the payload for a retreat', () => {
    expect(buildEventPayload(retreatForm(), true, false).endDate).toBe('2026-10-04');
  });

  it('strips the end date for a type that does not span days', () => {
    const form = { ...retreatForm(), eventType: 'Workshop' };

    expect(buildEventPayload(form, true, false).endDate).toBe('');
  });
});
