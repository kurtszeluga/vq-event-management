import { useCallback, useEffect, useRef, useState } from 'react';
import { beginSquareReservation, loadSquarePaymentConfig } from '../services/registrationService.js';
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
//   1. requestActive - a ref-based re-entrancy lock. The auto-reserve effect
//      and an explicit submit or test-card call can both reach
//      ensurePaymentReservation while a request is in flight; without the
//      lock each would create its own hold.
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
  const requestActive = useRef(false);

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
      throw new Error('Your payment seat hold expired. Start registration again.');
    }

    if (isPaymentReservationActive(paymentReservation)) {
      return paymentReservation;
    }

    if (!requiresSquarePayment) {
      return null;
    }

    if (requestActive.current) {
      return null;
    }

    requestActive.current = true;
    setPaymentReservationLoading(true);
    setPaymentReservationError('');

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
      requestActive.current = false;
    }
  }, [buildRegistrationRequest, paymentReservation, paymentReservationExpired, requiresSquarePayment]);

  useEffect(() => {
    if (!requiresSquarePayment || !readyToReserve || paymentReservation) {
      return;
    }

    ensurePaymentReservation().catch(() => {});
  }, [ensurePaymentReservation, paymentReservation, readyToReserve, requiresSquarePayment]);

  const markReservationExpired = useCallback(() => {
    setPaymentReservationExpired(true);
    setPaymentReservation(null);
    setPaymentReservationError('Your payment seat hold expired. Start registration again.');
    setSquareWalletToken('');
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
