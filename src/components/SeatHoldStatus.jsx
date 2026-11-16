import { useReservationCountdown } from '../hooks/useReservationCountdown.js';

// Every registration takes a seat hold now, regardless of payment type - a
// free or cash/check registrant is holding a seat exactly as much as an
// online-payment one, and should see the same countdown and the same
// waitlist fallback rather than only the paying registrant getting one.
// `seatsUnlimited` suppresses everything the hold says, not the hold itself.
// An event with no seat limit still takes a reservation, because the
// reservation is also what pins the amount Square is told to charge and makes
// the attempt idempotent - but telling a member their seat is held for the
// next ten minutes, on a signup that cannot run out of seats, invents a
// deadline and a reason to panic that do not exist. Errors still show: a
// reservation that failed means the registration is about to fail too.
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

  if (seatsUnlimited) {
    return null;
  }

  if (joiningWaitlist) {
    return (
      <p className="waitlist-notice">
        No seat is currently available. Submit to join the waitlist.
      </p>
    );
  }

  if (!timeLeft) {
    return null;
  }

  return (
    <p className={timeLeft === 'expired' ? 'form-error' : 'form-success'}>
      {timeLeft === 'expired'
        ? 'Your seat hold expired. Returning you to the listing.'
        : `Your seat is held for ${timeLeft} while you complete registration.`}
    </p>
  );
}

export default SeatHoldStatus;
