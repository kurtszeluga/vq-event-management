import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAYMENT_RESERVATION_EXPIRATION_MS,
  getEventCapacityError,
  getInitialPaymentStatus,
  getInitialRegistrationStatus,
  getReservationExpiryMillis,
  hasAvailableSeat,
  isActiveReservation,
  isSeatHoldingRegistration,
  reservationMatchesRequest,
  toAmountCents
} from '../api/_lib/registration-capacity.js';

const NOW = Date.parse('2026-07-24T12:00:00.000Z');

test('only registered and pending-payment registrations hold a seat', () => {
  assert.equal(isSeatHoldingRegistration({ status: 'Registered' }), true);
  assert.equal(isSeatHoldingRegistration({ status: 'Pending Payment' }), true);

  assert.equal(isSeatHoldingRegistration({ status: 'Cancelled' }), false);
  assert.equal(isSeatHoldingRegistration({ status: 'Waitlisted' }), false);
  assert.equal(isSeatHoldingRegistration({}), false);
});

test('an active payment hold consumes the last seat', () => {
  const event = { capacity: 1 };

  // Nobody registered, but another shopper is mid-checkout holding the seat.
  assert.equal(hasAvailableSeat({
    activeReservationCount: 1,
    activeSeatCount: 0,
    event
  }), false);

  // Once that hold lapses the seat is purchasable again.
  assert.equal(hasAvailableSeat({
    activeReservationCount: 0,
    activeSeatCount: 0,
    event
  }), true);
});

test('seats and holds are counted together against capacity', () => {
  const event = { capacity: 3 };

  assert.equal(hasAvailableSeat({
    activeReservationCount: 1,
    activeSeatCount: 1,
    event
  }), true);

  assert.equal(hasAvailableSeat({
    activeReservationCount: 1,
    activeSeatCount: 2,
    event
  }), false);
});

test('unlimited capacity always has a seat regardless of holds', () => {
  assert.equal(hasAvailableSeat({
    activeReservationCount: 99,
    activeSeatCount: 99,
    event: { capacity: 1, capacityUnlimited: true }
  }), true);
});

test('capacity of zero waitlists everyone, unlike the listing views', () => {
  // Regression guard for a known frontend/backend divergence: listing views
  // (src/utils/registrationAvailability.js and api/_lib/public-event-feed.js)
  // treat capacity 0 as "seats available", while registration waitlists every
  // submission. EventForm validation permits 0, so this state is reachable.
  assert.equal(hasAvailableSeat({
    activeReservationCount: 0,
    activeSeatCount: 0,
    event: { capacity: 0 }
  }), false);

  assert.equal(getInitialRegistrationStatus({
    hasCapacity: false,
    isPaidEvent: false,
    payLaterByCashCheck: false
  }), 'Waitlisted');
});

test('reservations stop counting once they expire', () => {
  const reservation = {
    expiresAt: new Date(NOW + 60 * 1000).toISOString(),
    status: 'Active'
  };

  assert.equal(isActiveReservation(reservation, NOW), true);
  assert.equal(isActiveReservation(reservation, NOW + 120 * 1000), false);
});

test('cancelled reservations never count even before expiry', () => {
  assert.equal(isActiveReservation({
    expiresAt: new Date(NOW + 60 * 1000).toISOString(),
    status: 'Consumed'
  }, NOW), false);
});

test('reservation expiry falls back to createdAt plus the hold window', () => {
  const createdAt = new Date(NOW).toISOString();

  assert.equal(
    getReservationExpiryMillis({ createdAt }),
    NOW + PAYMENT_RESERVATION_EXPIRATION_MS
  );

  // An explicit expiresAt always wins over the fallback.
  assert.equal(
    getReservationExpiryMillis({ createdAt, expiresAt: new Date(NOW + 1000).toISOString() }),
    NOW + 1000
  );
});

test('a payment hold only validates for its own event, email, and amount', () => {
  const expected = {
    amountDue: 25,
    email: 'member@example.com',
    eventId: 'event-a'
  };
  const reservation = {
    amountDue: 25,
    email: 'member@example.com',
    eventId: 'event-a',
    expiresAt: new Date(NOW + 60 * 1000).toISOString(),
    status: 'Active'
  };

  assert.equal(reservationMatchesRequest(reservation, expected, NOW), true);

  // A hold bought for a different event cannot be spent here.
  assert.equal(reservationMatchesRequest(
    { ...reservation, eventId: 'event-b' },
    expected,
    NOW
  ), false);

  // Nor can someone else's hold.
  assert.equal(reservationMatchesRequest(
    { ...reservation, email: 'other@example.com' },
    expected,
    NOW
  ), false);

  // A hold priced below the amount due cannot underpay the seat.
  assert.equal(reservationMatchesRequest(
    { ...reservation, amountDue: 5 },
    expected,
    NOW
  ), false);

  // An expired hold is rejected rather than silently reused.
  assert.equal(reservationMatchesRequest(reservation, expected, NOW + 120 * 1000), false);

  // A consumed hold cannot be replayed into a second registration.
  assert.equal(reservationMatchesRequest(
    { ...reservation, status: 'Consumed' },
    expected,
    NOW
  ), false);
});

test('amounts compare in whole cents so float drift cannot reject a valid hold', () => {
  // 0.1 + 0.2 is 0.30000000000000004 in IEEE-754; raw equality would fail.
  assert.notEqual(0.1 + 0.2, 0.3);
  assert.equal(toAmountCents(0.1 + 0.2), toAmountCents(0.3));

  const expected = { amountDue: 0.3, email: 'm@example.com', eventId: 'event-a' };
  const reservation = {
    amountDue: 0.1 + 0.2,
    email: 'm@example.com',
    eventId: 'event-a',
    expiresAt: new Date(NOW + 60 * 1000).toISOString(),
    status: 'Active'
  };

  assert.equal(reservationMatchesRequest(reservation, expected, NOW), true);
});

test('initial registration status covers the waitlist and payment paths', () => {
  const paidOnline = { hasCapacity: true, isPaidEvent: true, payLaterByCashCheck: false };

  assert.equal(getInitialRegistrationStatus(paidOnline), 'Pending Payment');

  // Cash/check later skips the payment hold and registers immediately.
  assert.equal(getInitialRegistrationStatus({
    ...paidOnline,
    payLaterByCashCheck: true
  }), 'Registered');

  // Free events register immediately.
  assert.equal(getInitialRegistrationStatus({
    hasCapacity: true,
    isPaidEvent: false,
    payLaterByCashCheck: false
  }), 'Registered');

  // No capacity outranks every payment path.
  assert.equal(getInitialRegistrationStatus({ ...paidOnline, hasCapacity: false }), 'Waitlisted');
  assert.equal(getInitialRegistrationStatus({
    hasCapacity: false,
    isPaidEvent: false,
    payLaterByCashCheck: false
  }), 'Waitlisted');
});

test('free events are never left in a payable state', () => {
  assert.equal(getInitialPaymentStatus({ isPaidEvent: false }), 'No Charge');
  assert.equal(getInitialPaymentStatus({ isPaidEvent: true }), 'Pending');
});

test('a capped event cannot be saved with zero capacity', () => {
  // The state that made listings advertise open seats while every registrant
  // was silently waitlisted.
  assert.notEqual(getEventCapacityError({ capacity: 0, capacityUnlimited: false }), '');
  assert.notEqual(getEventCapacityError({ capacityUnlimited: false }), '');
  assert.notEqual(getEventCapacityError({ capacity: -1, capacityUnlimited: false }), '');
  assert.notEqual(getEventCapacityError({ capacity: 2.5, capacityUnlimited: false }), '');
  assert.notEqual(getEventCapacityError({ capacity: 'lots', capacityUnlimited: false }), '');
});

test('capped events with real seat counts and unlimited events both save', () => {
  assert.equal(getEventCapacityError({ capacity: 1, capacityUnlimited: false }), '');
  assert.equal(getEventCapacityError({ capacity: 25, capacityUnlimited: false }), '');

  // Event types that do not use capacity are saved with capacityUnlimited true
  // and a capacity of 0, so they must stay exempt.
  assert.equal(getEventCapacityError({ capacity: 0, capacityUnlimited: true }), '');
  assert.equal(getEventCapacityError({ capacityUnlimited: true }), '');
});

test('a saved event always satisfies the capacity invariant registration relies on', () => {
  // Any event that clears validation must leave at least one seat available
  // when empty, so listings and registration cannot disagree.
  const savable = [
    { capacity: 1, capacityUnlimited: false },
    { capacity: 25, capacityUnlimited: false },
    { capacity: 0, capacityUnlimited: true }
  ];

  savable.forEach((event) => {
    assert.equal(getEventCapacityError(event), '');
    assert.equal(hasAvailableSeat({
      activeReservationCount: 0,
      activeSeatCount: 0,
      event
    }), true);
  });
});
