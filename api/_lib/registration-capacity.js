import { isPaymentPending } from '../../shared/registrationPayment.js';
import { getTimestampMillis } from './registration-verification.js';

export const PAYMENT_RESERVATION_EXPIRATION_MS = 5 * 60 * 1000;

const SEAT_HOLDING_STATUSES = ['Pending Payment', 'Registered'];

export function isSeatHoldingRegistration(registration = {}) {
  return SEAT_HOLDING_STATUSES.includes(registration.status);
}

// Capacity of 0 with capacityUnlimited unset yields no available seat, so every
// submission is waitlisted. Listing views treat 0 as "seats available" instead;
// see the divergence noted in PROJECT_UPGRADE.md before changing this.
export function hasAvailableSeat({
  event = {},
  activeSeatCount = 0,
  activeReservationCount = 0
} = {}) {
  return Boolean(event.capacityUnlimited)
    || activeSeatCount + activeReservationCount < Number(event.capacity || 0);
}

export function isActiveReservation(reservation = {}, now = Date.now()) {
  return reservation.status === 'Active'
    && getTimestampMillis(reservation.expiresAt) > now;
}

export function getReservationExpiryMillis(reservation = {}) {
  return getTimestampMillis(reservation.expiresAt)
    || getTimestampMillis(reservation.createdAt) + PAYMENT_RESERVATION_EXPIRATION_MS;
}

export function toAmountCents(value) {
  return Math.round(Number(value || 0) * 100);
}

export function reservationMatchesRequest(reservation = {}, expected = {}, now = Date.now()) {
  return reservation.status === 'Active'
    && reservation.eventId === expected.eventId
    && reservation.email === expected.email
    && toAmountCents(reservation.amountDue) === toAmountCents(expected.amountDue)
    && getReservationExpiryMillis(reservation) > now;
}

// An admin with registerOthers may register a member for cash/check on a
// case-by-case basis even when the event itself does not otherwise offer it -
// the override only ever widens what an already-permission-gated admin can
// do, never a self-registrant's options, since it is ignored for every other
// authorizationKind.
export function isCashCheckPaymentAllowed({
  allowCashCheckOverride = false,
  authorizationKind = '',
  event = {},
  paymentPreference = ''
} = {}) {
  if (paymentPreference !== 'cash-check-later') {
    return false;
  }

  if (event.allowCashCheckPayment) {
    return true;
  }

  return authorizationKind === 'admin' && allowCashCheckOverride === true;
}

export function getInitialRegistrationStatus({ hasCapacity, isPaidEvent, payLaterByCashCheck }) {
  if (!hasCapacity) {
    return 'Waitlisted';
  }

  if (isPaidEvent && !payLaterByCashCheck) {
    return 'Pending Payment';
  }

  return 'Registered';
}

export function getInitialPaymentStatus({ isPaidEvent }) {
  return isPaidEvent ? 'Pending' : 'No Charge';
}

const MANUAL_CASH_CHECK_METHODS = ['Cash', 'Check'];

// Admin-only shortcut: the member typically hands the admin cash/check at
// the moment they ask to be registered, so an admin who confirms that can
// mark the payment collected immediately instead of leaving every
// admin-initiated cash/check registration in Pending for a separate payment
// edit later. Never honored for a self-registrant's own request. The caller
// is also responsible for only applying this when the registration actually
// lands as 'Registered' - a waitlisted registrant has not secured a seat to
// pay for yet, so a full event must not mark its payment collected.
export function resolveAdminCollectedPayment({
  authorizationKind = '',
  payLaterByCashCheck = false,
  paymentMethod = '',
  paymentReceived = false
} = {}) {
  if (authorizationKind !== 'admin' || !payLaterByCashCheck || !paymentReceived) {
    return null;
  }

  return MANUAL_CASH_CHECK_METHODS.includes(paymentMethod) ? { method: paymentMethod } : null;
}

// A capped event must have room for at least one person. Capacity 0 with
// capacityUnlimited unset waitlists every registrant while listing views still
// advertise open seats, so the state is rejected at write time instead.
// Event types that do not use capacity are saved with capacityUnlimited true
// and are therefore exempt.
export function getEventCapacityError(eventData = {}) {
  if (eventData.capacityUnlimited) {
    return '';
  }

  const capacity = Number(eventData.capacity);

  if (!Number.isInteger(capacity) || capacity < 1) {
    return 'Maximum capacity must be at least 1, or select unlimited capacity.';
  }

  return '';
}

// Archiving should carry an event's full registration history with it -
// including Waitlisted registrants, who never held a seat or owed anything -
// but must not let a registration with money still outstanding fall out of
// view unresolved. Waitlisted registrants deliberately do not block: they
// have nothing to collect.
export function getArchiveBlockError(registrations = []) {
  const pendingCount = registrations.filter(isPaymentPending).length;

  if (!pendingCount) {
    return '';
  }

  return `Cannot archive this event: ${pendingCount} registration${pendingCount === 1 ? '' : 's'} `
    + `still ${pendingCount === 1 ? 'has' : 'have'} a payment awaiting collection. `
    + 'Resolve them in Payment Review before archiving.';
}
