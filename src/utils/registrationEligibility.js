import { getRegistrationWindowState } from '../../shared/registrationWindow.js';
import { formatDateOnly, isEventVisible } from './eventFormat.js';

export const CASH_CHECK_LATER = 'cash-check-later';

const MEMBERSHIP_BLOCKED_STATUSES = [
  'already-registered',
  'membership-blocked',
  'membership-not-found',
  'profile-membership-blocked'
];

// An event is paid only when it is flagged paid AND carries a cost. The server
// applies the same rule in api/create-registration.js; keep the two in step.
export function isPaidEvent(event) {
  return Boolean(event?.isPaid) && Number(event?.cost || 0) > 0;
}

// Billing address is collected for exactly the events that charge money.
export function requiresBillingAddress(event) {
  return isPaidEvent(event);
}

export function canPayLaterByCashCheck(event) {
  return isPaidEvent(event) && Boolean(event?.allowCashCheckPayment);
}

// What the registrant actually pays: the event cost plus the service fee.
export function getEventPaymentTotal(event) {
  return Number(event?.cost || 0) + Number(event?.serviceFee || 0);
}

export function requiresSquarePayment(event, paymentPreference) {
  return isPaidEvent(event) && paymentPreference !== CASH_CHECK_LATER;
}

export function isJoiningWaitlist(paymentReservation) {
  return paymentReservation?.status === 'Waitlisted';
}

// A waitlisted hold comes back with paymentRequired false, so the card step is
// skipped even though the event is paid.
export function isPaymentRequiredForSeat({ event, paymentPreference, paymentReservation }) {
  return requiresSquarePayment(event, paymentPreference)
    && paymentReservation?.paymentRequired !== false;
}

// Availability is derived from the configured window rather than from the
// stored `registrationOpen` flag, so a scheduled opening actually arrives and a
// close date actually closes. The server applies the same rule in
// api/create-registration.js via the same shared module; this gate only decides
// what the member sees.
export function getRegistrationUnavailableReason(event) {
  if (!event) {
    return '';
  }

  if (!isEventVisible(event)) {
    return 'This event is not currently available.';
  }

  const { state } = getRegistrationWindowState(event);

  if (state === 'not-registrable') {
    return 'This listing does not accept registrations.';
  }

  // Naming the date is the difference between "come back later" and a dead end.
  if (state === 'not-yet-open') {
    return `Registration for this event opens ${formatDateOnly(event.registrationOpenAt)}.`;
  }

  if (state === 'closed') {
    return `Registration for this event closed ${formatDateOnly(event.registrationCloseAt)}.`;
  }

  if (state === 'disabled') {
    return 'Registration is not currently open for this event.';
  }

  return '';
}

export function getProfileExists(lookup) {
  return Boolean(lookup?.profileExists);
}

export function isMembershipBlocked({ lookup, lookupComplete }) {
  return Boolean(lookupComplete) && MEMBERSHIP_BLOCKED_STATUSES.includes(lookup?.status);
}

export function needsAccountPassword({
  accountVerified,
  emailVerified,
  lookupComplete,
  membershipBlocked,
  profileExists,
  showEmailVerification
}) {
  return Boolean(lookupComplete)
    && Boolean(profileExists)
    && !membershipBlocked
    && !accountVerified
    && !emailVerified
    && !showEmailVerification;
}

export function needsEmailVerification({
  emailVerified,
  lookup,
  lookupComplete,
  membershipBlocked,
  profileExists,
  showEmailVerification
}) {
  return Boolean(lookupComplete)
    && !membershipBlocked
    && Boolean(lookup?.verificationRequired)
    && (!profileExists || Boolean(showEmailVerification))
    && !emailVerified;
}

// Gates the registrant/billing form. Identity must be proven first, either by
// password sign-in or by the emailed code, or contact fields would be editable
// before the person is known.
export function canShowRegistrantFields({
  accountVerified,
  emailVerified,
  lookupComplete,
  membershipBlocked
}) {
  return Boolean(lookupComplete)
    && !membershipBlocked
    && (Boolean(accountVerified) || Boolean(emailVerified));
}
