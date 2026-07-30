import { useCallback, useEffect, useRef, useState } from 'react';
import {
  beginSquareReservation,
  loadSquarePaymentConfig,
  releaseReservation as releaseReservationRequest
} from '../services/registrationService.js';
import {
  getEventPaymentTotal,
  isPaidEvent as getIsPaidEvent,
  isJoiningWaitlist,
  isPaymentRequiredForSeat,
  requiresSquarePayment as getRequiresSquarePayment
} from '../utils/registrationEligibility.js';

// Owns online payment: the Square SDK config/card handles and the temporary
// seat hold taken before the registrant enters card details.
//
// Seat holds count against event capacity server-side, so a stray hold
// silently consumes a seat. Two guards protect that, and both belong with
// this state rather than the page:
//
//   1. inFlightRequest - a ref holding the in-flight reservation promise.
//      The auto-reserve effect and an explicit submit or test-card call can
//      both reach ensurePaymentReservation while a request is running;
//      without this each would create its own hold. Concurrent callers get
//      the same promise, so they all end up with the same reservation.
//   2. The invalidation effect - any change to registrant identity, billing,
//      the event, or the payment preference drops the current hold. A hold is
//      bound server-side to an event, email, and exact amount, so reusing one
//      after those change is rejected by reservationMatchesRequest anyway.
export function usePaymentReservation({
  buildRegistrationRequest,
  event,
  eventId,
  paymentPreference,
  readyToReserve,
  registrant
}) {
  const {
    billingCity,
    billingCountry,
    billingPostalCode,
    billingState,
    billingStreet,
    email,
    firstName,
    lastName,
    phone
  } = registrant;

  const [squareCard, setSquareCard] = useState(null);
  const [squareConfig, setSquareConfig] = useState(null);
  const [squareError, setSquareError] = useState('');
  const [squareWalletToken, setSquareWalletToken] = useState('');
  const [paymentReservation, setPaymentReservation] = useState(null);
  const [paymentReservationError, setPaymentReservationError] = useState('');
  const [paymentReservationLoading, setPaymentReservationLoading] = useState(false);
  const [paymentReservationExpired, setPaymentReservationExpired] = useState(false);
  const inFlightRequest = useRef(null);
  const paymentReservationRef = useRef(null);

  useEffect(() => {
    paymentReservationRef.current = paymentReservation;
  }, [paymentReservation]);

  const isPaidEvent = getIsPaidEvent(event);
  const requiresSquarePayment = getRequiresSquarePayment(event, paymentPreference);
  const paymentRequiredForCurrentSeat = isPaymentRequiredForSeat({
    event,
    paymentPreference,
    paymentReservation
  });
  const joiningWaitlist = isJoiningWaitlist(paymentReservation);

  const resetPaymentReservation = useCallback(() => {
    setPaymentReservation(null);
    setPaymentReservationError('');
    setPaymentReservationExpired(false);
    setPaymentReservationLoading(false);
  }, []);

  useEffect(() => {
    if (!isPaidEvent) {
      setSquareCard(null);
      setSquareConfig(null);
      setSquareError('');
      setSquareWalletToken('');
      return;
    }

    let active = true;

    loadSquarePaymentConfig()
      .then((config) => {
        if (!active) {
          return;
        }

        setSquareConfig(config);
        setSquareError(config.enabled ? '' : 'Online card payment is not configured yet.');
      })
      .catch((error) => {
        if (active) {
          setSquareCard(null);
          setSquareConfig(null);
          setSquareError(error.message);
        }
      });

    return () => {
      active = false;
    };
  }, [isPaidEvent]);

  useEffect(() => {
    setSquareWalletToken('');
    setPaymentReservation(null);
    setPaymentReservationError('');
    setPaymentReservationExpired(false);
  }, [
    billingCity,
    billingCountry,
    billingPostalCode,
    billingState,
    billingStreet,
    email,
    eventId,
    firstName,
    lastName,
    paymentPreference,
    phone
  ]);

  const ensurePaymentReservation = useCallback(async () => {
    if (paymentReservationExpired) {
      throw new Error('Your seat hold expired. Start registration again.');
    }

    if (isPaymentReservationActive(paymentReservation)) {
      return paymentReservation;
    }

    // Every registration holds a seat the same way regardless of payment
    // type - requiresSquarePayment only decides whether card entry is
    // needed once the hold comes back, not whether to take one at all.

    // Concurrent callers await the same request rather than being turned
    // away. Returning null here instead would let submit proceed with no
    // reservation id, which the server rejects as an expired hold - and that
    // is reachable in normal use, since editing any billing field drops the
    // hold and immediately triggers a new one.
    if (inFlightRequest.current) {
      return inFlightRequest.current;
    }

    setPaymentReservationLoading(true);
    setPaymentReservationError('');

    const request = (async () => {
      try {
        const reservation = await beginSquareReservation(buildRegistrationRequest());

        setPaymentReservation(reservation);
        setPaymentReservationError('');
        setPaymentReservationExpired(false);
        return reservation;
      } catch (error) {
        setPaymentReservation(null);
        setPaymentReservationError(error.message);
        throw error;
      } finally {
        setPaymentReservationLoading(false);
      }
    })();

    inFlightRequest.current = request;

    // Cleared out here rather than in the block above: a failure before the
    // first await would run that finally synchronously, before the
    // assignment, stranding a settled promise in the slot permanently. The
    // identity check keeps a slow request from clearing a newer one.
    request
      .catch(() => {})
      .finally(() => {
        if (inFlightRequest.current === request) {
          inFlightRequest.current = null;
        }
      });

    return request;
  }, [buildRegistrationRequest, paymentReservation, paymentReservationExpired]);

  useEffect(() => {
    if (!readyToReserve || paymentReservation) {
      return;
    }

    ensurePaymentReservation().catch(() => {});
  }, [ensurePaymentReservation, paymentReservation, readyToReserve]);

  const markReservationExpired = useCallback(() => {
    setPaymentReservationExpired(true);
    setPaymentReservation(null);
    setPaymentReservationError('Your seat hold expired. Start registration again.');
    setSquareWalletToken('');
  }, []);

  // Fire-and-forget: called when the registrant backs out (Cancel) so the
  // seat frees up immediately instead of sitting held until the reservation
  // naturally expires. Reads the current reservation via a ref rather than
  // depending on paymentReservation directly so callers can fire this from
  // an unmount/close handler without it changing identity on every
  // reservation refresh.
  const releaseCurrentReservation = useCallback(() => {
    const reservation = paymentReservationRef.current;

    if (!reservation?.reservationId) {
      return;
    }

    releaseReservationRequest(reservation.reservationId, reservation.reservationToken);
  }, []);

  const tokenizeSquarePayment = useCallback(async () => {
    if (squareWalletToken) {
      return squareWalletToken;
    }

    if (!squareCard) {
      throw new Error(squareError || 'Card payment is not ready yet.');
    }

    const tokenResult = await squareCard.tokenize({
      amount: getEventPaymentTotal(event).toFixed(2),
      billingContact: {
        addressLines: [billingStreet].filter(Boolean),
        city: billingCity,
        countryCode: 'US',
        email,
        familyName: lastName,
        givenName: firstName,
        phone,
        postalCode: billingPostalCode,
        state: billingState
      },
      currencyCode: 'USD',
      customerInitiated: true,
      intent: 'CHARGE',
      sellerKeyedIn: false
    });

    if (tokenResult.status !== 'OK') {
      throw new Error(getSquareTokenizeError(tokenResult));
    }

    return tokenResult.token;
  }, [
    billingCity,
    billingPostalCode,
    billingState,
    billingStreet,
    email,
    event,
    firstName,
    lastName,
    phone,
    squareCard,
    squareError,
    squareWalletToken
  ]);

  return {
    ensurePaymentReservation,
    isPaidEvent,
    joiningWaitlist,
    markReservationExpired,
    paymentRequiredForCurrentSeat,
    paymentReservation,
    paymentReservationError,
    paymentReservationExpired,
    paymentReservationLoading,
    releaseCurrentReservation,
    requiresSquarePayment,
    resetPaymentReservation,
    setSquareCard,
    setSquareWalletToken,
    squareCard,
    squareConfig,
    squareError,
    squareWalletToken,
    tokenizeSquarePayment
  };
}

export function isPaymentReservationActive(reservation) {
  return Boolean(
    reservation?.reservationId
      && reservation?.expiresAt
      && Date.parse(reservation.expiresAt) > Date.now()
  );
}

export function getSquareTokenizeError(tokenResult) {
  const errors = tokenResult?.errors || [];
  const message = errors
    .map((squareError) => squareError.message)
    .filter(Boolean)
    .join(' ');

  return message || 'Card payment could not be verified. Please check the card details and try again.';
}
