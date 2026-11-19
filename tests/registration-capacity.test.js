import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PAYMENT_RESERVATION_EXPIRATION_MS,
  computeRegistrationSummary,
  getArchiveBlockError,
  getEventCapacityError,
  getEventImagesError,
  getInitialPaymentStatus,
  getInitialRegistrationStatus,
  getReservationExpiryMillis,
  hasActiveWaitlistOffer,
  hasAvailableSeat,
  isActiveReservation,
  isCashCheckPaymentAllowed,
  isSeatHoldingRegistration,
  reservationMatchesRequest,
  resolveAdminCollectedPayment,
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

test('hasActiveWaitlistOffer is true only while the offer has not yet expired', () => {
  assert.equal(hasActiveWaitlistOffer({}, NOW), false);
  assert.equal(
    hasActiveWaitlistOffer({ waitlistOfferExpiresAt: new Date(NOW + 1000).toISOString() }, NOW),
    true
  );
  assert.equal(
    hasActiveWaitlistOffer({ waitlistOfferExpiresAt: new Date(NOW - 1000).toISOString() }, NOW),
    false
  );
});

test('a waitlisted registration with an active offer holds the seat it was offered', () => {
  const offered = {
    status: 'Waitlisted',
    waitlistOfferExpiresAt: new Date(NOW + 1000).toISOString()
  };
  const expiredOffer = {
    status: 'Waitlisted',
    waitlistOfferExpiresAt: new Date(NOW - 1000).toISOString()
  };

  assert.equal(isSeatHoldingRegistration(offered, NOW), true);
  assert.equal(isSeatHoldingRegistration(expiredOffer, NOW), false);
  // Never offered at all - the plain "waitlisted, nothing pending" case.
  assert.equal(isSeatHoldingRegistration({ status: 'Waitlisted' }, NOW), false);
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

test('requireAmountMatch: false lets a hold release/consume even if the event price changed underneath it', () => {
  // Only an actual online payment is authorized against the hold's amount -
  // everywhere else the hold just identifies the registrant's own seat, so
  // an event edited mid-flight must not orphan it until the 5-minute
  // timeout even though the price no longer matches.
  const expected = {
    amountDue: 0,
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

  assert.equal(reservationMatchesRequest(reservation, expected, NOW), false);
  assert.equal(
    reservationMatchesRequest(reservation, expected, NOW, { requireAmountMatch: false }),
    true
  );

  // Event/email/status/expiry still gate it even with amount matching off.
  assert.equal(
    reservationMatchesRequest(
      { ...reservation, eventId: 'event-b' },
      expected,
      NOW,
      { requireAmountMatch: false }
    ),
    false
  );
  assert.equal(
    reservationMatchesRequest(
      { ...reservation, status: 'Consumed' },
      expected,
      NOW,
      { requireAmountMatch: false }
    ),
    false
  );
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

test('an event is refused when more than MAX_EVENT_IMAGES are supplied', () => {
  assert.notEqual(
    getEventImagesError({ imageUrls: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg'] }),
    ''
  );
});

test('an event at or under the image cap, or with no imageUrls at all, saves cleanly', () => {
  assert.equal(getEventImagesError({ imageUrls: ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg'] }), '');
  assert.equal(getEventImagesError({ imageUrls: [] }), '');
  assert.equal(getEventImagesError({}), '');
  assert.equal(getEventImagesError({ imageUrls: 'not-an-array' }), '');
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

test('an event that already allows cash/check accepts it for anyone requesting it', () => {
  const event = { allowCashCheckPayment: true };

  assert.equal(isCashCheckPaymentAllowed({
    authorizationKind: 'firebase',
    event,
    paymentPreference: 'cash-check-later'
  }), true);

  assert.equal(isCashCheckPaymentAllowed({
    authorizationKind: 'admin',
    event,
    paymentPreference: 'cash-check-later'
  }), true);
});

test('a self-registrant cannot use the admin cash/check override', () => {
  const event = { allowCashCheckPayment: false };

  assert.equal(isCashCheckPaymentAllowed({
    allowCashCheckOverride: true,
    authorizationKind: 'firebase',
    event,
    paymentPreference: 'cash-check-later'
  }), false);
});

test('an admin can override cash/check for an event that does not otherwise offer it', () => {
  const event = { allowCashCheckPayment: false };

  assert.equal(isCashCheckPaymentAllowed({
    allowCashCheckOverride: true,
    authorizationKind: 'admin',
    event,
    paymentPreference: 'cash-check-later'
  }), true);

  // The override only ever widens what an admin can do - it is not honored
  // without being explicitly set.
  assert.equal(isCashCheckPaymentAllowed({
    allowCashCheckOverride: false,
    authorizationKind: 'admin',
    event,
    paymentPreference: 'cash-check-later'
  }), false);
});

test('cash/check is never allowed without the cash-check-later payment preference, override or not', () => {
  assert.equal(isCashCheckPaymentAllowed({
    allowCashCheckOverride: true,
    authorizationKind: 'admin',
    event: { allowCashCheckPayment: true },
    paymentPreference: ''
  }), false);
});

test('a cash/check-only event always allows cash/check, regardless of preference or authorization', () => {
  const event = { allowCashCheckPayment: true, cashCheckOnly: true };

  // No preference sent at all - the event has no online option to fall back
  // to, so a tampered or stale request still cannot be charged online.
  assert.equal(isCashCheckPaymentAllowed({
    authorizationKind: 'firebase',
    event,
    paymentPreference: ''
  }), true);

  assert.equal(isCashCheckPaymentAllowed({
    authorizationKind: 'admin',
    event,
    paymentPreference: 'online'
  }), true);
});

test('an admin who confirms cash/check was collected marks the payment received', () => {
  assert.deepEqual(resolveAdminCollectedPayment({
    authorizationKind: 'admin',
    paymentMethod: 'Cash',
    paymentReceived: true,
    payLaterByCashCheck: true
  }), { method: 'Cash' });

  assert.deepEqual(resolveAdminCollectedPayment({
    authorizationKind: 'admin',
    paymentMethod: 'Check',
    paymentReceived: true,
    payLaterByCashCheck: true
  }), { method: 'Check' });
});

test('a self-registrant can never mark their own payment received', () => {
  assert.equal(resolveAdminCollectedPayment({
    authorizationKind: 'firebase',
    paymentMethod: 'Cash',
    paymentReceived: true,
    payLaterByCashCheck: true
  }), null);
});

test('payment is not treated as collected unless the admin actually confirmed it', () => {
  assert.equal(resolveAdminCollectedPayment({
    authorizationKind: 'admin',
    paymentMethod: 'Cash',
    paymentReceived: false,
    payLaterByCashCheck: true
  }), null);
});

test('payment collection requires the registration to actually be on the cash/check path', () => {
  assert.equal(resolveAdminCollectedPayment({
    authorizationKind: 'admin',
    paymentMethod: 'Cash',
    paymentReceived: true,
    payLaterByCashCheck: false
  }), null);
});

test('an unrecognized payment method is never honored, even if paymentReceived is true', () => {
  assert.equal(resolveAdminCollectedPayment({
    authorizationKind: 'admin',
    paymentMethod: 'Bitcoin',
    paymentReceived: true,
    payLaterByCashCheck: true
  }), null);
});

test('archiving is blocked while a registration still owes payment', () => {
  const error = getArchiveBlockError([
    { paymentStatus: 'Pending', status: 'Registered' }
  ]);

  assert.notEqual(error, '');
  assert.match(error, /1 registration/);
});

test('an incomplete online checkout also blocks archiving', () => {
  const error = getArchiveBlockError([
    { status: 'Pending Payment' }
  ]);

  assert.notEqual(error, '');
});

test('a waitlisted registration never blocks archiving - nothing is owed yet', () => {
  assert.equal(getArchiveBlockError([
    { paymentStatus: 'Pending', status: 'Waitlisted' }
  ]), '');
});

test('paid, refunded, and cancelled registrations do not block archiving', () => {
  assert.equal(getArchiveBlockError([
    { paymentStatus: 'Paid', status: 'Registered' },
    { paymentStatus: 'Refunded', status: 'Cancelled' },
    { paymentStatus: 'No Charge', status: 'Registered' }
  ]), '');
});

test('archiving with no registrations at all is never blocked', () => {
  assert.equal(getArchiveBlockError([]), '');
  assert.equal(getArchiveBlockError(), '');
});

test('the archive-block message pluralizes correctly for more than one pending registration', () => {
  const error = getArchiveBlockError([
    { paymentStatus: 'Pending', status: 'Registered' },
    { status: 'Pending Payment' }
  ]);

  assert.match(error, /2 registrations/);
  assert.match(error, /have a payment/);
});

test('computeRegistrationSummary counts registered/waitlisted/cancelled and sums only Paid amounts', () => {
  const summary = computeRegistrationSummary(
    { capacity: 10 },
    [
      { paymentStatus: 'Paid', amountPaid: 25, status: 'Registered' },
      { paymentStatus: 'Paid', amountPaid: 15, status: 'Registered' },
      { status: 'Waitlisted' },
      { status: 'Cancelled' },
      { paymentStatus: 'Refunded', amountPaid: 25, status: 'Cancelled' }
    ]
  );

  assert.equal(summary.registered, 2);
  assert.equal(summary.waitlisted, 1);
  assert.equal(summary.cancelled, 2);
  assert.equal(summary.totalPaid, 40);
});

test('computeRegistrationSummary reports pending payment using the same broad definition as everywhere else', () => {
  const summary = computeRegistrationSummary(
    { capacity: 10 },
    [
      { paymentStatus: 'Pending', status: 'Registered' },
      { status: 'Pending Payment' },
      { paymentStatus: 'Paid', status: 'Registered' }
    ]
  );

  assert.equal(summary.pendingPayment, 2);
});

test('computeRegistrationSummary derives seatsAvailable from capacity minus registered, never below zero', () => {
  const under = computeRegistrationSummary(
    { capacity: 5 },
    [{ status: 'Registered' }, { status: 'Registered' }]
  );
  const over = computeRegistrationSummary(
    { capacity: 1 },
    [{ status: 'Registered' }, { status: 'Registered' }, { status: 'Registered' }]
  );

  assert.equal(under.seatsAvailable, 3);
  assert.equal(over.seatsAvailable, 0);
});

test('computeRegistrationSummary reports no seat ceiling for unlimited capacity', () => {
  const summary = computeRegistrationSummary(
    { capacity: 0, capacityUnlimited: true },
    [{ status: 'Registered' }]
  );

  assert.equal(summary.capacityUnlimited, true);
  assert.equal(summary.seatsAvailable, null);
});

test('computeRegistrationSummary reports null seatsAvailable when capacity was never set', () => {
  const summary = computeRegistrationSummary({}, [{ status: 'Registered' }]);

  assert.equal(summary.capacity, 0);
  assert.equal(summary.seatsAvailable, null);
});

test('computeRegistrationSummary handles an event with no registrations at all', () => {
  const summary = computeRegistrationSummary({ capacity: 10 }, []);

  assert.deepEqual(summary, {
    cancelled: 0,
    pendingPayment: 0,
    registered: 0,
    waitlisted: 0,
    capacity: 10,
    capacityUnlimited: false,
    seatsAvailable: 10,
    totalPaid: 0
  });
});
