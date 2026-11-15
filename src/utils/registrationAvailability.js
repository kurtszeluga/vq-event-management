// Whether an event has run out of seats, given a count of how many are taken.
//
// Split out so a caller that counts seats for itself can ask the same question
// without having to produce the {registered, pendingPayment, held} shape
// below. The Registrations module is one: it holds the registration records
// rather than the API's summary, and its own tallies deliberately overlap - a
// Registered cash/check row awaiting collection counts as both registered and
// pendingPayment - so adding those two up would report events full that are
// not.
export function isEventFullForSeats(event, seatsTaken) {
  if (event?.capacityUnlimited) {
    return false;
  }

  const capacity = Number(event?.capacity || 0);

  // A capacity of 0 reads as "not set" here rather than "no seats"; see the
  // divergence noted against hasAvailableSeat in api/_lib/registration-capacity.js.
  if (!capacity) {
    return false;
  }

  return Number(seatsTaken || 0) >= capacity;
}

export function getRegistrationAvailability(event, counts = {}) {
  if (event?.capacityUnlimited) {
    return {
      isFull: false,
      label: 'Unlimited',
      tone: 'open'
    };
  }

  const capacity = Number(event?.capacity || 0);

  if (!capacity) {
    return {
      isFull: false,
      label: 'Seats available',
      tone: 'open'
    };
  }

  const registeredCount = Number(counts.registered || 0)
    + Number(counts.pendingPayment || 0)
    + Number(counts.held || 0);

  if (isEventFullForSeats(event, registeredCount)) {
    const pendingPaymentCount = Number(counts.pendingPayment || 0);

    return {
      isFull: true,
      label: counts.held
        ? 'Seat on hold - waitlist available'
        : pendingPaymentCount
          ? 'Seat pending payment - waitlist available'
          : 'Full - waitlist available',
      tone: 'waitlist'
    };
  }

  return {
    isFull: false,
    label: 'Seats available',
    tone: 'open'
  };
}
