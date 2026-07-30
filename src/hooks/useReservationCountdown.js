import { useEffect, useRef, useState } from 'react';

// Ticks a live "4:59" style countdown against a reservation's expiresAt.
// Shared by every place that shows a seat hold, since the countdown math
// and expiry handling are identical regardless of what the hold is for.
export function useReservationCountdown(reservation, onExpired) {
  const [timeLeft, setTimeLeft] = useState('');
  const expiredHandledRef = useRef(false);

  useEffect(() => {
    if (!reservation?.expiresAt) {
      setTimeLeft('');
      expiredHandledRef.current = false;
      return undefined;
    }

    expiredHandledRef.current = false;

    function updateCountdown() {
      const millisLeft = Date.parse(reservation.expiresAt) - Date.now();

      if (millisLeft <= 0) {
        setTimeLeft('expired');
        if (!expiredHandledRef.current) {
          expiredHandledRef.current = true;
          onExpired();
        }
        return;
      }

      const minutes = Math.floor(millisLeft / 60000);
      const seconds = Math.floor((millisLeft % 60000) / 1000);

      setTimeLeft(`${minutes}:${String(seconds).padStart(2, '0')}`);
    }

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 1000);

    return () => window.clearInterval(intervalId);
  }, [onExpired, reservation]);

  return timeLeft;
}
