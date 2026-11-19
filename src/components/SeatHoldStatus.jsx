import { useReservationCountdown } from '../hooks/useReservationCountdown.js';

// Every registration takes a seat hold now, regardless of payment type - a
// free or cash/check registrant is holding a seat exactly as much as an
// online-payment one, and should see the same countdown and the same
// waitlist fallback rather than only the paying registrant getting one.
//
// `seatsUnlimited` changes what the hold is called, not whether it is shown.
// An event with no seat limit still takes a reservation, because it also pins
// the amount Square is told to charge and makes the attempt idempotent, and
// it still runs out. This used to hide the countdown entirely on the grounds
// that a signup which cannot run out of seats should not show a seat
// deadline - which was true about seats and wrong about the deadline. The
// hold expiring stops the form either way, so hiding it meant a member read
// the terms, came back, and found a page that had quietly stopped working.
//
// So the deadline is shown to everyone; only the reason differs. Where seats
// are unlimited it is described as what it actually constrains - the time
// left to pay - rather than as a seat nobody is competing for.
function SeatHoldStatus({
  joiningWaitlist,
  onExpired,
  reservation,
  reservationError,
  reservationLoading,
  seatsUnlimited = false
}) {
  const timeLeft = useReservationCountdown(reservation, onExpired);

  if (reservationLoading || (!reservation && !reservationError)) {
    return seatsUnlimited ? null : <p className="form-help">Holding your seat...</p>;
  }

  if (reservationError) {
    return <p className="form-error">{reservationError}</p>;
  }

  if (joiningWaitlist && !seatsUnlimited) {
    return (
      <p className="waitlist-notice">
        No seat is currently available. Submit to join the waitlist.
      </p>
    );
  }

  if (!timeLeft) {
    return null;
  }

  if (timeLeft === 'expired') {
    return (
      <p className="form-error">
        {seatsUnlimited
          ? 'Your time to complete payment ran out. Start again below.'
          : 'Your seat hold expired. Start registration again.'}
      </p>
    );
  }

  // The live figure rather than a written-out number of minutes: the window
  // is set in one place on the server, and a sentence here claiming "ten
  // minutes" would go quietly wrong the moment that changes.
  return (
    <p className="form-success">
      {seatsUnlimited
        ? `You have ${timeLeft} to complete your payment.`
        : `Your seat is held for ${timeLeft} while you complete registration.`}
    </p>
  );
}

export default SeatHoldStatus;
