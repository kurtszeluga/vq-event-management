import { useCallback, useEffect, useRef, useState } from 'react';
import { getSquareTokenizeError } from '../hooks/usePaymentReservation.js';
import { formatCurrency } from '../utils/eventFormat.js';

const squareScriptPromises = new Map();

// The seat hold itself (countdown, waitlist fallback, expiry) is shown by
// SeatHoldStatus for every registration regardless of payment type - this
// panel only ever renders when card entry is actually needed, so it is
// purely about the Square card/wallet UI.
export default function RegistrationPaymentPanel({
  amountDue,
  config,
  disabled,
  error,
  onCardReady,
  onEnsureReservation,
  onWalletTokenReady,
  onlinePaymentRequired,
  selectedPaymentToken
}) {
  const applePayRef = useRef(null);
  const cardContainerId = useRef(`square-card-${Math.random().toString(36).slice(2)}`);
  const googlePayContainerId = useRef(`square-google-pay-${Math.random().toString(36).slice(2)}`);
  const [localError, setLocalError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testCardMessage, setTestCardMessage] = useState('');
  const [walletMessage, setWalletMessage] = useState('');
  const [walletProcessing, setWalletProcessing] = useState('');
  const selectedPaymentTokenRef = useRef(selectedPaymentToken);
  const [walletSupport, setWalletSupport] = useState({
    applePay: false,
    googlePay: false
  });

  useEffect(() => {
    selectedPaymentTokenRef.current = selectedPaymentToken;
  }, [selectedPaymentToken]);

  const handleWalletPayment = useCallback(async (paymentMethod, walletName) => {
    if (!paymentMethod || disabled) {
      return;
    }

    setLocalError('');
    setWalletMessage('');
    setWalletProcessing(walletName);
    onWalletTokenReady('');

    try {
      const tokenResult = await paymentMethod.tokenize();

      if (tokenResult.status !== 'OK') {
        throw new Error(getSquareTokenizeError(tokenResult));
      }

      onWalletTokenReady(tokenResult.token);
      setWalletMessage(`${walletName} authorized. Click Submit Registration to finish.`);
    } catch (walletError) {
      onWalletTokenReady('');
      setLocalError(walletError.message || `${walletName} could not be verified.`);
    } finally {
      setWalletProcessing('');
    }
  }, [disabled, onWalletTokenReady]);

  useEffect(() => {
    if (!onlinePaymentRequired || !config?.enabled) {
      onCardReady(null);
      onWalletTokenReady('');
      setWalletSupport({ applePay: false, googlePay: false });
      return undefined;
    }

    let cancelled = false;
    let cardInstance = null;
    let googlePayClickHandler = null;
    let googlePayContainer = null;
    let walletInstances = [];

    async function initializeSquarePayments() {
      setLoading(true);
      setLocalError('');
      setWalletMessage('');
      onWalletTokenReady('');
      setWalletSupport({ applePay: false, googlePay: false });

      try {
        validateSquarePaymentConfig(config);
        await loadSquareScript(config.scriptUrl);

        if (!window.Square) {
          throw new Error('Square payment form could not be loaded.');
        }

        const payments = window.Square.payments(config.applicationId, config.locationId);
        const paymentRequest = buildSquarePaymentRequest(payments, amountDue);

        if (config.enableCardPayments !== false) {
          if (selectedPaymentTokenRef.current === 'cnon:card-nonce-ok') {
            onCardReady(null);
            return;
          }

          cardInstance = await payments.card();

          // The effect re-runs whenever config or amountDue arrives, and its
          // cleanup destroys whatever cardInstance holds. Without a check at
          // each await boundary the destroyed instance was then attached, which
          // is what produced the intermittent "An unexpected error occurred
          // while using Card" on first load - a race, which is why it looked
          // random and why calling payments.card() by hand always worked.
          if (cancelled) {
            destroyPaymentMethod(cardInstance);
            cardInstance = null;
            return;
          }

          const cardContainer = document.getElementById(cardContainerId.current);

          if (!cardContainer || selectedPaymentTokenRef.current === 'cnon:card-nonce-ok') {
            // Destroyed here rather than left for the cleanup: this path
            // abandons the instance, and an unattached card left behind holds
            // the Square iframe open.
            destroyPaymentMethod(cardInstance);
            cardInstance = null;
            onCardReady(null);
            return;
          }

          try {
            await cardInstance.attach(`#${cardContainerId.current}`);
          } catch (attachError) {
            // A cleanup landing mid-attach rejects here. That is an unmount,
            // not something the member needs to be told about.
            if (cancelled) {
              return;
            }

            throw attachError;
          }

          if (cancelled) {
            destroyPaymentMethod(cardInstance);
            cardInstance = null;
            return;
          }

          onCardReady(cardInstance);
        }

        if (config.enableApplePay) {
          try {
            const applePay = await payments.applePay(paymentRequest);
            walletInstances.push(applePay);

            if (!cancelled) {
              applePayRef.current = applePay;
              setWalletSupport((current) => ({ ...current, applePay: true }));
            }
          } catch {
            if (!cancelled) {
              applePayRef.current = null;
              setWalletSupport((current) => ({ ...current, applePay: false }));
            }
          }
        }

        if (config.enableGooglePay) {
          try {
            const googlePay = await payments.googlePay(paymentRequest);
            walletInstances.push(googlePay);
            googlePayContainer = document.getElementById(googlePayContainerId.current);

            await googlePay.attach(`#${googlePayContainerId.current}`);

            googlePayClickHandler = (clickEvent) => {
              clickEvent.preventDefault();
              handleWalletPayment(googlePay, 'Google Pay');
            };
            googlePayContainer?.addEventListener('click', googlePayClickHandler);

            if (!cancelled) {
              setWalletSupport((current) => ({ ...current, googlePay: true }));
            }
          } catch {
            if (!cancelled) {
              setWalletSupport((current) => ({ ...current, googlePay: false }));
            }
          }
        }
      } catch (squareLoadError) {
        if (!cancelled) {
          onCardReady(null);
          if (selectedPaymentTokenRef.current !== 'cnon:card-nonce-ok') {
            onWalletTokenReady('');
            setLocalError(squareLoadError.message || 'Square payment form could not be loaded.');
          }
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initializeSquarePayments();

    return () => {
      cancelled = true;
      onCardReady(null);
      onWalletTokenReady('');
      applePayRef.current = null;

      if (googlePayContainer && googlePayClickHandler) {
        googlePayContainer.removeEventListener('click', googlePayClickHandler);
      }

      destroyPaymentMethod(cardInstance);
      walletInstances.forEach(destroyPaymentMethod);
    };
  }, [amountDue, config, handleWalletPayment, onCardReady, onWalletTokenReady, onlinePaymentRequired]);

  return (
    <div className="registration-payment-panel">
      <strong>Payment</strong>
      <span className="form-help">
        Amount due: {formatCurrency(amountDue)}
      </span>
      <p className="form-help">
        Card, Apple Pay, and Google Pay information is entered directly into Square&apos;s secure payment form.
        The Village Quilters Network does not store your card number, security code, or wallet payment details.
      </p>
      {onlinePaymentRequired ? (
        <>
          {walletSupport.applePay || walletSupport.googlePay ? (
            <div className="square-wallet-section">
              {walletSupport.applePay ? (
                <button
                  aria-label="Pay with Apple Pay"
                  className="square-apple-pay-button"
                  disabled={disabled || Boolean(walletProcessing)}
                  type="button"
                  onClick={() => handleWalletPayment(applePayRef.current, 'Apple Pay')}
                >
                  {walletProcessing === 'Apple Pay' ? 'Authorizing Apple Pay...' : ''}
                </button>
              ) : null}
              {walletSupport.googlePay ? (
                <div
                  aria-label="Pay with Google Pay"
                  className={`square-google-pay-container${disabled || walletProcessing ? ' is-disabled' : ''}`}
                  id={googlePayContainerId.current}
                />
              ) : null}
              {walletMessage ? <p className="form-success">{walletMessage}</p> : null}
            </div>
          ) : null}
          {config?.environment === 'sandbox' && config?.enableCardPayments !== false ? (
            <div className="sandbox-card-helper">
              <strong>Sandbox Test Card</strong>
              <button
                className="button-link button-reset compact-action"
                type="button"
                onClick={() => selectSandboxTestPayment({
                  onEnsureReservation,
                  onWalletTokenReady,
                  setLocalError,
                  setMessage: setTestCardMessage
                })}
              >
                {selectedPaymentToken === 'cnon:card-nonce-ok' ? 'Test Card Selected' : 'Use Test Card'}
              </button>
              <span>
                {selectedPaymentToken === 'cnon:card-nonce-ok'
                  ? 'Square sandbox test payment is ready. No card fields need to be typed.'
                  : 'Uses Square sandbox token cnon:card-nonce-ok.'}
              </span>
              {testCardMessage ? <span className="form-help">{testCardMessage}</span> : null}
            </div>
          ) : null}
          {config?.enableCardPayments !== false ? (
            <>
              {(walletSupport.applePay || walletSupport.googlePay) && selectedPaymentToken !== 'cnon:card-nonce-ok' ? (
                <span className="form-help">Or enter a card:</span>
              ) : null}
              <div
                aria-label="Secure Square card payment form"
                className={`square-card-container${disabled ? ' is-disabled' : ''}${selectedPaymentToken === 'cnon:card-nonce-ok' ? ' is-test-token-selected' : ''}`}
                id={cardContainerId.current}
              />
            </>
          ) : null}
          {selectedPaymentToken === 'cnon:card-nonce-ok' ? (
            <p className="form-success">
              Test payment selected. Click Submit Registration to complete the sandbox payment.
            </p>
          ) : null}
          {config?.enableCardPayments === false && !walletSupport.applePay && !walletSupport.googlePay ? (
            <p className="form-error">
              No enabled online payment methods are available in this browser.
            </p>
          ) : null}
          {loading ? <p className="form-help">Loading secure payment form...</p> : null}
          {error || localError ? <p className="form-error">{error || localError}</p> : null}
        </>
      ) : null}
    </div>
  );
}

// Square throws if an instance is destroyed twice, or destroyed before it
// finished attaching. That throw would escape a React cleanup function and
// take the unmount with it, so nothing here is allowed to be fatal - the
// instance is being discarded either way.
function destroyPaymentMethod(paymentMethod) {
  if (!paymentMethod || typeof paymentMethod.destroy !== 'function') {
    return;
  }

  try {
    paymentMethod.destroy();
  } catch {
    // Discarded regardless.
  }
}

async function selectSandboxTestPayment({
  onEnsureReservation,
  onWalletTokenReady,
  setLocalError,
  setMessage
}) {
  setLocalError('');
  setMessage('Starting seat hold...');

  try {
    await onEnsureReservation();
    onWalletTokenReady('cnon:card-nonce-ok');
    setMessage('Test payment selected. Click Submit Registration to finish.');
  } catch (error) {
    onWalletTokenReady('');
    setMessage('');
    setLocalError(error.message || 'Seat hold could not be created.');
  }
}

function loadSquareScript(scriptUrl) {
  if (!scriptUrl) {
    return Promise.reject(new Error('Square payment script is not configured.'));
  }

  if (window.Square) {
    return Promise.resolve();
  }

  if (!squareScriptPromises.has(scriptUrl)) {
    squareScriptPromises.set(scriptUrl, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Square payment script could not be loaded.'));
      document.head.appendChild(script);
    }));
  }

  return squareScriptPromises.get(scriptUrl);
}

function validateSquarePaymentConfig(config) {
  const applicationId = String(config?.applicationId || '').trim();
  const locationId = String(config?.locationId || '').trim();
  const expectedAppIdPrefix = config?.environment === 'production'
    ? 'sq0idp-'
    : 'sandbox-sq0idb-';

  if (!applicationId || !locationId) {
    throw new Error('Online payment setup is missing the Square application ID or location ID.');
  }

  if (!applicationId.startsWith(expectedAppIdPrefix)) {
    throw new Error(
      `Online payment setup has an invalid Square application ID. Check SQUARE_APPLICATION_ID in Vercel; it should start with ${expectedAppIdPrefix}.`
    );
  }
}

function buildSquarePaymentRequest(payments, amountDue) {
  return payments.paymentRequest({
    countryCode: 'US',
    currencyCode: 'USD',
    total: {
      amount: Number(amountDue || 0).toFixed(2),
      label: 'The Village Quilters'
    }
  });
}
