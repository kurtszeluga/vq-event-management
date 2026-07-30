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
const { buildEventPayload, getInitialForm, validateEventForm } = await import('../../src/components/admin/EventForm.jsx');

// These fixtures represent the form state after handlePaymentTypeSelection
// has run for each of the three payment types - it is not exported, so the
// save-time contract (buildEventPayload) is what's under test here, matching
// this file's existing convention for EventForm (see eventFormSupplyList/
// eventFormImages tests). The live checkbox interaction (mutual exclusivity,
// the Allow-cash/check sub-toggle only appearing under Online) is verified
// in the browser rather than duplicated here.
function paymentForm(overrides = {}) {
  return {
    ...DEFAULT_EVENT_FORM,
    eventType: 'Workshop',
    ...overrides
  };
}

describe('buildEventPayload payment type', () => {
  it('Free: isPaid, cashCheckOnly, allowCashCheckPayment, cost, and serviceFee are all false/zero', () => {
    const form = paymentForm({
      allowCashCheckPayment: false,
      cashCheckOnly: false,
      cost: '0',
      isPaid: false,
      serviceFee: '0'
    });

    const payload = buildEventPayload(form, false, false);

    expect(payload.isPaid).toBe(false);
    expect(payload.cashCheckOnly).toBe(false);
    expect(payload.allowCashCheckPayment).toBe(false);
    expect(payload.cost).toBe(0);
    expect(payload.serviceFee).toBe(0);
  });

  it('Online: isPaid true, cashCheckOnly false, allowCashCheckPayment follows the sub-toggle', () => {
    const withSubToggleOff = paymentForm({
      allowCashCheckPayment: false,
      cashCheckOnly: false,
      cost: '25',
      isPaid: true,
      serviceFee: '1'
    });
    const withSubToggleOn = paymentForm({
      allowCashCheckPayment: true,
      cashCheckOnly: false,
      cost: '25',
      isPaid: true,
      serviceFee: '1'
    });

    const payloadOff = buildEventPayload(withSubToggleOff, false, false);
    const payloadOn = buildEventPayload(withSubToggleOn, false, false);

    expect(payloadOff.isPaid).toBe(true);
    expect(payloadOff.cashCheckOnly).toBe(false);
    expect(payloadOff.allowCashCheckPayment).toBe(false);
    expect(payloadOff.cost).toBe(25);
    expect(payloadOff.serviceFee).toBe(1);

    expect(payloadOn.allowCashCheckPayment).toBe(true);
    expect(payloadOn.cashCheckOnly).toBe(false);
  });

  it('Cash/Check Only: isPaid true, cashCheckOnly true, allowCashCheckPayment forced true even if the sub-toggle was never set, and serviceFee forced to 0 - there is no card transaction for it to cover', () => {
    const form = paymentForm({
      allowCashCheckPayment: false,
      cashCheckOnly: true,
      cost: '25',
      isPaid: true,
      serviceFee: '1'
    });

    const payload = buildEventPayload(form, false, false);

    expect(payload.isPaid).toBe(true);
    expect(payload.cashCheckOnly).toBe(true);
    expect(payload.allowCashCheckPayment).toBe(true);
    expect(payload.cost).toBe(25);
    expect(payload.serviceFee).toBe(0);
  });

  it('an event type that does not use fees always saves as free with cashCheckOnly false, even if the form still holds paid values', () => {
    const form = paymentForm({
      allowCashCheckPayment: true,
      cashCheckOnly: true,
      cost: '25',
      eventType: 'Lecture',
      isPaid: true,
      serviceFee: '1'
    });

    const payload = buildEventPayload(form, false, false);

    expect(payload.isPaid).toBe(false);
    expect(payload.cashCheckOnly).toBe(false);
    expect(payload.allowCashCheckPayment).toBe(false);
    expect(payload.cost).toBe(0);
    expect(payload.serviceFee).toBe(0);
  });

  it('getInitialForm reads a stored cashCheckOnly value back unchanged', () => {
    const form = getInitialForm({
      allowCashCheckPayment: true,
      cashCheckOnly: true,
      cost: 25,
      eventType: 'Workshop',
      isPaid: true,
      serviceFee: 1
    });

    expect(form.cashCheckOnly).toBe(true);
  });

  it('getInitialForm defaults cashCheckOnly to false for a brand-new event', () => {
    const form = getInitialForm(null, 'Workshop');

    expect(form.cashCheckOnly).toBe(false);
  });
});

describe('validateEventForm cost requirement', () => {
  it('rejects a $0 cost for Online - that is what Free is for', () => {
    const form = paymentForm({ cost: '0', isPaid: true });

    expect(validateEventForm(form).cost).toBeTruthy();
  });

  it('rejects a $0 cost for Cash/Check Only', () => {
    const form = paymentForm({ cashCheckOnly: true, cost: '0', isPaid: true });

    expect(validateEventForm(form).cost).toBeTruthy();
  });

  it('rejects an empty or negative cost the same way', () => {
    expect(validateEventForm(paymentForm({ cost: '', isPaid: true })).cost).toBeTruthy();
    expect(validateEventForm(paymentForm({ cost: '-5', isPaid: true })).cost).toBeTruthy();
  });

  it('accepts a positive cost', () => {
    const form = paymentForm({ cost: '25', isPaid: true });

    expect(validateEventForm(form).cost).toBeUndefined();
  });

  it('does not require a cost at all for Free', () => {
    const form = paymentForm({ cost: '0', isPaid: false });

    expect(validateEventForm(form).cost).toBeUndefined();
  });
});
