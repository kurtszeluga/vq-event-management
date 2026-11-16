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

const { DEFAULT_EVENT_FORM, UNLISTED_EVENT_TYPES, EVENT_TYPES } = await import('../../src/data/eventOptions.js');
const { buildEventPayload } = await import('../../src/components/admin/EventForm.jsx');
const { DEFAULT_MEMBERSHIP_FEE_SCHEDULE } = await import('../../shared/membershipDues.js');

function membershipForm(overrides = {}) {
  return {
    ...DEFAULT_EVENT_FORM,
    description: 'Join or renew your guild membership.',
    eventType: 'Membership',
    listingMode: 'now',
    registrationMode: 'now',
    title: 'Guild Membership',
    ...overrides
  };
}

describe('a saved Membership event', () => {
  it('is paid and carries the dues schedule, whatever the fee fields say', () => {
    // The Payment Type radios are not shown for this type, so isPaid is never
    // set by hand - the schedule is what makes it a paid event.
    const payload = buildEventPayload(membershipForm({ isPaid: null }), false, false);

    expect(payload.isPaid).toBe(true);
    expect(payload.membershipFeeSchedule).toEqual(DEFAULT_MEMBERSHIP_FEE_SCHEDULE);
  });

  it('stores the regular rate as cost, so a reader that misses the helper overquotes', () => {
    const payload = buildEventPayload(membershipForm(), false, false);

    expect(payload.cost).toBe(DEFAULT_MEMBERSHIP_FEE_SCHEDULE.regularFee);
    expect(payload.cost).toBeGreaterThan(DEFAULT_MEMBERSHIP_FEE_SCHEDULE.earlyFee);
  });

  it('has unlimited capacity, so nobody is ever waitlisted for joining', () => {
    const payload = buildEventPayload(
      membershipForm({ capacity: '20', capacityUnlimited: false }),
      false,
      false
    );

    expect(payload.capacityUnlimited).toBe(true);
    expect(payload.capacity).toBe(0);
  });

  it('collects no date, time or presenter - it runs over its listing window', () => {
    const payload = buildEventPayload(
      membershipForm({ date: '2026-08-01', presenter: 'Someone', startTime: '09:30' }),
      false,
      false
    );

    expect(payload.date).toBe('');
    expect(payload.presenter).toBe('');
    expect(payload.startTime).toBe('00:00');
    expect(payload.endTime).toBe('00:00');
  });

  it('keeps its service fee, which is editable per event', () => {
    const payload = buildEventPayload(membershipForm({ serviceFee: '2.50' }), false, false);

    expect(payload.serviceFee).toBe(2.5);

    const free = buildEventPayload(membershipForm({ serviceFee: '0' }), false, false);

    expect(free.serviceFee).toBe(0);
  });

  it('writes a custom schedule through rather than the defaults', () => {
    const payload = buildEventPayload(
      membershipForm({
        membershipEarlyFee: '30',
        membershipEarlyStart: '06-01',
        membershipRegularFee: '60',
        membershipRegularStart: '09-01'
      }),
      false,
      false
    );

    expect(payload.membershipFeeSchedule).toEqual({
      earlyFee: 30,
      earlyStart: '06-01',
      regularFee: 60,
      regularStart: '09-01'
    });
    expect(payload.cost).toBe(60);
  });
});

describe('every other event type', () => {
  it('saves a null schedule, so switching away from Membership clears it', () => {
    const payload = buildEventPayload(
      {
        ...DEFAULT_EVENT_FORM,
        cost: '35',
        date: '2026-08-01',
        description: 'A class.',
        eventType: 'Class (Half Day)',
        isPaid: true,
        listingMode: 'now',
        registrationMode: 'now',
        title: 'Binding Class'
      },
      false,
      false
    );

    expect(payload.membershipFeeSchedule).toBeNull();
    expect(payload.cost).toBe(35);
    expect(payload.isPaid).toBe(true);
  });
});

describe('the unlisted types', () => {
  it('names Membership, and only types that actually exist', () => {
    expect(UNLISTED_EVENT_TYPES).toContain('Membership');
    UNLISTED_EVENT_TYPES.forEach((type) => {
      expect(EVENT_TYPES).toContain(type);
    });
  });
});
