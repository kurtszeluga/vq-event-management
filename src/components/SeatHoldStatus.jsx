import { useReservationCountdown } from '../hooks/useReservationCountdown.js';

// Every registration takes a seat hold now, regardless of payment type - a
// free or cash/check registrant is holding a seat exactly as much as an
// online-payment one, and should see the same countdown and the same
// waitlist fallback rather than only the paying registrant getting one.
function SeatHoldStatus({
  joiningWaitlist,
  onExpired,
  reservation,
  reservationError,
  reservationLoading
}) {
  const timeLeft = useReservationCountdown(reservation, onExpired);

  if (reservationLoading || (!reservation && !reservationError)) {
    return <p className="form-help">Holding your seat...</p>;
  }

  if (reservationError) {
    return <p className="form-error">{reservationError}</p>;
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
