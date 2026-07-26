import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CASH_CHECK_LATER,
  canPayLaterByCashCheck,
  canShowRegistrantFields,
  getRegistrationUnavailableReason,
  isCashCheckAwaitingCollection,
  isJoiningWaitlist,
  isMembershipBlocked,
  isPaidEvent,
  isPaymentPending,
  isPaymentRequiredForSeat,
  needsAccountPassword,
  needsEmailVerification,
  requiresBillingAddress,
  requiresSquarePayment
} from '../src/utils/registrationEligibility.js';

const PAID_EVENT = { cost: 25, isPaid: true };
const FREE_EVENT = { cost: 0, isPaid: false };

test('an event is paid only when flagged paid and carrying a cost', () => {
  assert.equal(isPaidEvent(PAID_EVENT), true);
  assert.equal(isPaidEvent(FREE_EVENT), false);

  // Flagged paid but priced at zero is not chargeable.
  assert.equal(isPaidEvent({ cost: 0, isPaid: true }), false);

  // Priced but not flagged paid is not chargeable either.
  assert.equal(isPaidEvent({ cost: 25, isPaid: false }), false);

  assert.equal(isPaidEvent(null), false);
  assert.equal(isPaidEvent(undefined), false);
});

test('billing address is collected for exactly the chargeable events', () => {
  // These were two identical expressions on adjacent lines in RegisterPage;
  // they must not drift apart.
  [PAID_EVENT, FREE_EVENT, { cost: 0, isPaid: true }, null].forEach((event) => {
    assert.equal(requiresBillingAddress(event), isPaidEvent(event));
  });
});

test('cash or check later is offered only when the event opts in', () => {
  assert.equal(canPayLaterByCashCheck({ ...PAID_EVENT, allowCashCheckPayment: true }), true);
  assert.equal(canPayLaterByCashCheck({ ...PAID_EVENT, allowCashCheckPayment: false }), false);
  assert.equal(canPayLaterByCashCheck(PAID_EVENT), false);

  // A free event never offers a pay-later choice.
  assert.equal(canPayLaterByCashCheck({ ...FREE_EVENT, allowCashCheckPayment: true }), false);
});

test('choosing cash or check later skips the Square payment step', () => {
  assert.equal(requiresSquarePayment(PAID_EVENT, ''), true);
  assert.equal(requiresSquarePayment(PAID_EVENT, 'online'), true);
  assert.equal(requiresSquarePayment(PAID_EVENT, CASH_CHECK_LATER), false);

  // Free events never require card payment whatever the preference.
  assert.equal(requiresSquarePayment(FREE_EVENT, 'online'), false);
});

test('a waitlisted hold skips the card step even on a paid event', () => {
  // The server returns paymentRequired false when the seat went to the
  // waitlist, so the registrant must not be charged.
  assert.equal(isPaymentRequiredForSeat({
    event: PAID_EVENT,
    paymentPreference: 'online',
    paymentReservation: { paymentRequired: false, status: 'Waitlisted' }
  }), false);

  assert.equal(isPaymentRequiredForSeat({
    event: PAID_EVENT,
    paymentPreference: 'online',
    paymentReservation: { paymentRequired: true, status: 'Active' }
  }), true);

  // No hold yet still counts as payment required, so the card field renders.
  assert.equal(isPaymentRequiredForSeat({
    event: PAID_EVENT,
    paymentPreference: 'online',
    paymentReservation: null
  }), true);
});

test('waitlist status is read from the reservation', () => {
  assert.equal(isJoiningWaitlist({ status: 'Waitlisted' }), true);
  assert.equal(isJoiningWaitlist({ status: 'Active' }), false);
  assert.equal(isJoiningWaitlist(null), false);
});

// Availability now comes from the configured date window rather than the stored
// `registrationOpen` flag, so these fixtures carry a real window.
function openEvent(overrides = {}) {
  const dayMs = 24 * 60 * 60 * 1000;
  const asLocalInput = (offsetMs) =>
    new Date(Date.now() + offsetMs).toISOString().slice(0, 16);

  return {
    eventType: 'Workshop',
    registrationMode: 'now',
    registrationOpenAt: asLocalInput(-7 * dayMs),
    registrationCloseAt: asLocalInput(7 * dayMs),
    status: 'Published',
    ...overrides
  };
}

test('registration is refused for hidden, closed, and non-registrable listings', () => {
  const open = openEvent();

  assert.equal(getRegistrationUnavailableReason(open), '');

  // No event loaded yet is not an error state.
  assert.equal(getRegistrationUnavailableReason(null), '');

  assert.match(
    getRegistrationUnavailableReason({ ...open, status: 'Archived' }),
    /not currently available/
  );
  assert.match(
    getRegistrationUnavailableReason({ ...open, registrationMode: 'none' }),
    /not currently open/
  );
  assert.match(
    getRegistrationUnavailableReason({ ...open, eventType: 'Business Listing' }),
    /does not accept registrations/
  );
  assert.match(
    getRegistrationUnavailableReason({ ...open, eventType: 'For Sale' }),
    /does not accept registrations/
  );
});

test('the stored registrationOpen flag no longer decides availability', () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const asLocalInput = (offsetMs) =>
    new Date(Date.now() + offsetMs).toISOString().slice(0, 16);

  // What EventForm writes for mode 'now': the flag stays true forever, so the
  // old gate kept registration open past the close date.
  assert.match(getRegistrationUnavailableReason(openEvent({
    registrationOpen: true,
    registrationCloseAt: asLocalInput(-dayMs)
  })), /closed/);

  // What EventForm writes for mode 'future': the flag stays false forever, so
  // the old gate never let a scheduled opening arrive.
  assert.equal(getRegistrationUnavailableReason(openEvent({
    registrationMode: 'future',
    registrationOpen: false
  })), '');
});

test('a member is told when registration opens or closed, not just that it is shut', () => {
  const dayMs = 24 * 60 * 60 * 1000;
  const asLocalInput = (offsetMs) =>
    new Date(Date.now() + offsetMs).toISOString().slice(0, 16);

  const notYet = getRegistrationUnavailableReason(openEvent({
    registrationOpenAt: asLocalInput(7 * dayMs)
  }));
  const closed = getRegistrationUnavailableReason(openEvent({
    registrationCloseAt: asLocalInput(-dayMs)
  }));

  assert.match(notYet, /opens/);
  assert.match(notYet, /\d{2}\/\d{2}\/\d{4}/);
  assert.match(closed, /closed/);
  assert.match(closed, /\d{2}\/\d{2}\/\d{4}/);
});

test('a listing hidden by its visibility window refuses registration', () => {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  assert.match(getRegistrationUnavailableReason({
    eventType: 'Workshop',
    registrationOpen: true,
    status: 'Published',
    visibleFrom: future
  }), /not currently available/);

  assert.match(getRegistrationUnavailableReason({
    eventType: 'Workshop',
    registrationOpen: true,
    status: 'Published',
    visibleUntil: past
  }), /not currently available/);
});

test('membership blocking only applies once lookup has completed', () => {
  assert.equal(isMembershipBlocked({
    lookup: { status: 'membership-blocked' },
    lookupComplete: true
  }), true);

  assert.equal(isMembershipBlocked({
    lookup: { status: 'already-registered' },
    lookupComplete: true
  }), true);

  // Same status, but the lookup has not returned yet.
  assert.equal(isMembershipBlocked({
    lookup: { status: 'membership-blocked' },
    lookupComplete: false
  }), false);

  assert.equal(isMembershipBlocked({ lookup: null, lookupComplete: true }), false);
  assert.equal(isMembershipBlocked({
    lookup: { status: 'ok' },
    lookupComplete: true
  }), false);
});

test('registrant fields stay hidden until identity is proven', () => {
  const base = {
    accountVerified: false,
    emailVerified: false,
    lookupComplete: true,
    membershipBlocked: false
  };

  // The security-relevant case: contact and billing fields must not render
  // before the person has proven who they are.
  assert.equal(canShowRegistrantFields(base), false);

  assert.equal(canShowRegistrantFields({ ...base, accountVerified: true }), true);
  assert.equal(canShowRegistrantFields({ ...base, emailVerified: true }), true);

  // Verified but blocked by membership still shows nothing.
  assert.equal(canShowRegistrantFields({
    ...base,
    emailVerified: true,
    membershipBlocked: true
  }), false);

  // Verified but the lookup never completed.
  assert.equal(canShowRegistrantFields({
    ...base,
    emailVerified: true,
    lookupComplete: false
  }), false);
});

test('an existing profile is asked for its password before anything else', () => {
  const base = {
    accountVerified: false,
    emailVerified: false,
    lookupComplete: true,
    membershipBlocked: false,
    profileExists: true,
    showEmailVerification: false
  };

  assert.equal(needsAccountPassword(base), true);

  // Once verified either way, stop asking.
  assert.equal(needsAccountPassword({ ...base, accountVerified: true }), false);
  assert.equal(needsAccountPassword({ ...base, emailVerified: true }), false);

  // Falling back to the emailed code hides the password prompt.
  assert.equal(needsAccountPassword({ ...base, showEmailVerification: true }), false);

  // No profile means there is no password to ask for.
  assert.equal(needsAccountPassword({ ...base, profileExists: false }), false);

  assert.equal(needsAccountPassword({ ...base, membershipBlocked: true }), false);
});

test('the emailed code is requested for new registrants and as a password fallback', () => {
  const base = {
    emailVerified: false,
    lookup: { verificationRequired: true },
    lookupComplete: true,
    membershipBlocked: false,
    profileExists: false,
    showEmailVerification: false
  };

  // A registrant with no profile verifies by email code.
  assert.equal(needsEmailVerification(base), true);

  // An existing profile only sees the code step after choosing the fallback.
  assert.equal(needsEmailVerification({ ...base, profileExists: true }), false);
  assert.equal(needsEmailVerification({
    ...base,
    profileExists: true,
    showEmailVerification: true
  }), true);

  // Already verified, or the server did not ask for verification.
  assert.equal(needsEmailVerification({ ...base, emailVerified: true }), false);
  assert.equal(needsEmailVerification({ ...base, lookup: { verificationRequired: false } }), false);
  assert.equal(needsEmailVerification({ ...base, membershipBlocked: true }), false);
});

test('cash/check awaiting collection requires a held seat and an unpaid status', () => {
  assert.equal(
    isCashCheckAwaitingCollection({ paymentStatus: 'Pending', status: 'Registered' }),
    true
  );

  // No seat held yet - nothing to collect payment for.
  assert.equal(
    isCashCheckAwaitingCollection({ paymentStatus: 'Pending', status: 'Waitlisted' }),
    false
  );

  // Already collected.
  assert.equal(
    isCashCheckAwaitingCollection({ paymentStatus: 'Paid', status: 'Registered' }),
    false
  );

  assert.equal(isCashCheckAwaitingCollection(null), false);
});

test('a registration whose status is still literally Pending Payment reads as payment pending too', () => {
  assert.equal(isPaymentPending({ status: 'Pending Payment' }), true);
  assert.equal(isPaymentPending({ paymentStatus: 'Pending', status: 'Registered' }), true);
  assert.equal(isPaymentPending({ paymentStatus: 'Paid', status: 'Registered' }), false);
  assert.equal(isPaymentPending({ status: 'Waitlisted' }), false);
  assert.equal(isPaymentPending(null), false);
});
