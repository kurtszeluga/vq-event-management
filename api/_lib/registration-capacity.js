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
