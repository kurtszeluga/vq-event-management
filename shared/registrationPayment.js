// Dependency-free so both src/ (client) and api/ (server) can import the same
// definition - see shared/registrationWindow.js for the established pattern.

// A registration only needs collecting once it actually holds a seat - a
// Waitlisted registrant has nothing to collect payment for yet - and only
// while it is still genuinely unpaid. Deliberately does NOT also require
// paymentPreference === 'cash-check-later': a confirmed (Registered),
// unpaid (paymentStatus Pending) registration for a paid event can only
// exist via the cash/check path in the current code, but older records (or
// one an admin reset to Pending via the Edit Registration payment form)
// can have paymentPreference blank or stale.
export function isCashCheckAwaitingCollection(registration) {
  return Boolean(registration)
    && registration.status === 'Registered'
    && registration.paymentStatus === 'Pending';
}

// Broader than isCashCheckAwaitingCollection: also counts a registration
// whose STATUS is still the literal 'Pending Payment' (an online card
// checkout that has not completed yet). Both read as "payment is pending"
// to an admin looking at an event's stat pills, even though only the
// cash/check case is something Payment Review's Mark Paid action applies to.
export function isPaymentPending(registration) {
  return Boolean(registration)
    && (registration.status === 'Pending Payment' || isCashCheckAwaitingCollection(registration));
}
