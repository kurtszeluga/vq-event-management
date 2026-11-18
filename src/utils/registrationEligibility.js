import {
  getExternalRegistrationUrl,
  getRegistrationWindowState
} from '../../shared/registrationWindow.js';
import { isCashCheckAwaitingCollection, isPaymentPending } from '../../shared/registrationPayment.js';
import { getEventCostOn } from '../../shared/membershipDues.js';
import { formatDateOnly, isEventVisible } from './eventFormat.js';

export { isCashCheckAwaitingCollection, isPaymentPending };

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
  return Boolean(event?.isPaid) && getEventCostOn(event) > 0;
}

// Billing address is collected for exactly the events that charge money.
export function requiresBillingAddress(event) {
  return isPaidEvent(event);
}

export function canPayLaterByCashCheck(event) {
  return isPaidEvent(event) && Boolean(event?.allowCashCheckPayment);
}

// A cash/check-only event never offers cash/check as an optional
// alternative to online payment - it is the only method, so the registrant
// is never actually asked to choose.
export function mustPayByCashCheck(event) {
  return isPaidEvent(event) && Boolean(event?.cashCheckOnly);
}

// What the registrant actually pays: the event cost plus the service fee.
//
// getEventCostOn rather than event.cost, because a Membership event is priced
// by the day the member signs up. Every other type returns its stored cost
// unchanged, so this is the same answer it always gave for them.
export function getEventPaymentTotal(event, options = {}) {
  return getEventCostOn(event, options) + Number(event?.serviceFee || 0);
}

export function requiresSquarePayment(event, paymentPreference) {
  return isPaidEvent(event) && !event?.cashCheckOnly && paymentPreference !== CASH_CHECK_LATER;
}

// Whether this registration is holding a seat it has been offered and not yet
// answered - the condition for offering an admin the Pass To Next control,
// since with no outstanding offer there is no seat to pass on and the control
// would only drop someone off the waitlist for nothing.
//
// Mirrors hasActiveWaitlistOffer in api/_lib/registration-capacity.js, which
// is server-only. The two disagreeing is mild in this direction: a stale
// clock shows a control whose request the server then refuses with a reason.
export function hasOutstandingWaitlistOffer(registration) {
  if (registration?.status !== 'Waitlisted') {
    return false;
  }

  const expiresAt = registration.waitlistOfferExpiresAt;

  if (!expiresAt) {
    return false;
  }

  const expiresAtMillis = typeof expiresAt.toDate === 'function'
    ? expiresAt.toDate().getTime()
    : new Date(expiresAt).getTime();

  return !Number.isNaN(expiresAtMillis) && expiresAtMillis > Date.now();
}

// Mirrors isSeatHoldingRegistration in api/_lib/registration-capacity.js: the
// statuses that occupy a seat, plus a waitlisted registration holding an offer
// it has not yet answered.
//
// Counting registrations with this, rather than adding up the Registrations
// module's own tallies, is deliberate - those overlap, because a Registered
// cash/check row awaiting collection is counted as both registered and
// pendingPayment, so summing them reports events full that are not. A status
// is a single value, so one pass over the records cannot double-count.
export function holdsSeat(registration) {
  return registration?.status === 'Registered'
    || registration?.status === 'Pending Payment'
    || hasOutstandingWaitlistOffer(registration);
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

  // Naming which of the three visibility conditions failed, rather than one
  // catch-all sentence: an admin testing an unlisted event and a member on a
  // stale link were both told only that it was "not available", which reads as
  // a fault in the page.
  if (!isEventVisible(event)) {
    if (event.status === 'Archived') {
      return 'This event has been archived, so it is no longer open for registration.';
    }

    if (event.status !== 'Published') {
      return 'This event is still a draft, so it is not open for registration yet.';
    }

    const now = Date.now();
    const visibleFrom = event.visibleFrom ? Date.parse(event.visibleFrom) : null;
    const visibleUntil = event.visibleUntil ? Date.parse(event.visibleUntil) : null;

    if (visibleFrom && visibleFrom > now) {
      return `This event is not listed on the website until ${formatDateOnly(event.visibleFrom)}, `
        + 'so registration is not open yet.';
    }

    if (visibleUntil && visibleUntil < now) {
      return `This event was removed from the website ${formatDateOnly(event.visibleUntil)}, `
        + 'so it is no longer open for registration.';
    }

    return 'This event is not currently available.';
  }

  // Go-live transition: an event carrying externalRegistrationUrl is still run
  // by the guild's previous system, so nothing in this app can take a
  // registration for it. The server refuses these in
  // validateRegistrationEligibility, in this same position - after visibility,
  // before the window - but until now no caller asked first, so both the
  // member page and the admin's Register A Member panel rendered a full form
  // and failed on submit. The two listing pages already point their Register
  // control at the link instead; this covers everything that does not.
  if (getExternalRegistrationUrl(event)) {
    return 'Registration for this event is handled through the link shown on the event listing, not in this app.';
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

// Whether a signup must take the guild's terms before it can be submitted.
//
// Only an unlisted signup, and only once the emailed code has been accepted -
// `canShowRegistrantFields` is what turns true at that moment, and there is no
// point putting an agreement in front of someone who has not yet proved the
// address is theirs. A completed registration drops it, so the confirmation
// does not re-ask for something already given.
//
// Deliberately separate from the reactivation agreement, which answers
// "reinstate my archived profile" rather than "I am joining the guild". One
// flag for both would let either stand in for the other.
// Whether the editable name/phone/address grid is on screen.
//
// Normally a matched profile is shown in the lookup card instead, with an Edit
// button that sets needsProfileEdits - so the grid stays shut until asked for.
// A standalone signup has no lookup card (it reports account details that flow
// has no business showing), so hiding the grid there left a returning member
// with no fields at all and nothing explaining why.
export function showsRegistrantFields({
  isStandaloneSignup,
  matchedProfile,
  needsProfileEdits
}) {
  return !matchedProfile || Boolean(needsProfileEdits) || Boolean(isStandaloneSignup);
}

export function needsMembershipTerms({
  canShowRegistrantFields,
  confirmed,
  isStandaloneSignup
}) {
  return Boolean(isStandaloneSignup) && Boolean(canShowRegistrantFields) && !confirmed;
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
