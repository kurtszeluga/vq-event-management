import { MAX_EVENT_IMAGES } from '../../shared/eventImages.js';
import { isPaymentPending } from '../../shared/registrationPayment.js';
import { getTimestampMillis } from './registration-verification.js';

export const PAYMENT_RESERVATION_EXPIRATION_MS = 5 * 60 * 1000;

const SEAT_HOLDING_STATUSES = ['Pending Payment', 'Registered'];

// A Waitlisted registration with an unexpired offer is holding the seat that
// was just offered to it - this is the entire mechanism preventing that seat
// from being double-offered or grabbed by a fresh registrant during the
// claim window, with no separate reservation collection needed.
export function hasActiveWaitlistOffer(registration = {}, now = Date.now()) {
  const expiresAt = getTimestampMillis(registration.waitlistOfferExpiresAt);
  return Boolean(expiresAt) && expiresAt > now;
}

export function isSeatHoldingRegistration(registration = {}, now = Date.now()) {
  return SEAT_HOLDING_STATUSES.includes(registration.status)
    || (registration.status === 'Waitlisted' && hasActiveWaitlistOffer(registration, now));
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

// EventForm.jsx already caps uploads at MAX_EVENT_IMAGES and slices to it
// before saving; this is defense in depth for this authenticated write path,
// not a client-input trust boundary.
export function getEventImagesError(eventData = {}) {
  if (Array.isArray(eventData.imageUrls) && eventData.imageUrls.length > MAX_EVENT_IMAGES) {
    return `An event can have at most ${MAX_EVENT_IMAGES} images.`;
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

// Mirrors RegistrationPanel.jsx's own reduceRegistrationCounts/
// getTotalPaidAmount bucketing exactly, so a coordinator notification email's
// numbers always agree with what an admin sees in the Registrations card for
// the same event - server-side only, since that component is a React file
// api/ code cannot import from.
export function computeRegistrationSummary(event = {}, registrations = []) {
  const counts = registrations.reduce(
    (summary, registration) => {
      if (isPaymentPending(registration)) {
        summary.pendingPayment += 1;
      }

      if (registration.status === 'Registered') {
        summary.registered += 1;
      } else if (registration.status === 'Waitlisted') {
        summary.waitlisted += 1;
      } else if (registration.status === 'Cancelled') {
        summary.cancelled += 1;
      }

      return summary;
    },
    { cancelled: 0, pendingPayment: 0, registered: 0, waitlisted: 0 }
  );
  const totalPaid = registrations
    .filter((registration) => registration?.paymentStatus === 'Paid')
    .reduce((total, registration) => total + Number(registration.amountPaid || 0), 0);
  const capacityUnlimited = Boolean(event.capacityUnlimited);
  const capacity = Number(event.capacity || 0);
  const seatsAvailable = capacityUnlimited || !capacity
    ? null
    : Math.max(capacity - counts.registered, 0);

  return {
    ...counts,
    capacity,
    capacityUnlimited,
    seatsAvailable,
    totalPaid
  };
}
