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
  // Resolves once the previous card and wallets have finished tearing down.
  const teardownRef = useRef(Promise.resolve());
  const googlePayContainerId = useRef(`square-google-pay-${Math.random().toString(36).slice(2)}`);
  const [localError, setLocalError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testCardMessage, setTestCardMessage] = useState('');
  const [walletMessage, setWalletMessage] = useState('');
  const [walletProcessing, setWalletProcessing] = useState('');
  const selectedPaymentTokenRef = useRef(selectedPaymentToken);
  // googlePay is deliberately tri-state - null means "still setting up",
  // which is the window during which its container has to be on the page.
  // See the note on the wallet section below.
  const [walletSupport, setWalletSupport] = useState({
    applePay: false,
    googlePay: null
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
      // The previous run's cleanup cannot await its own teardown - a React
      // cleanup is synchronous - so it leaves the promise here and this run
      // waits for it. Without that, a re-render that remounts the form has a
      // new card attaching into a container the old one is still vacating,
      // which is precisely the "unexpected error" Square reports.
      try {
        await teardownRef.current;
      } catch {
        // A failed teardown must not stop the next form being built.
      }

      if (cancelled) {
        return;
      }

      setLoading(true);
      setLocalError('');
      setWalletMessage('');
      onWalletTokenReady('');
      setWalletSupport({ applePay: false, googlePay: config.enableGooglePay ? null : false });

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
          } catch (applePayError) {
            if (!cancelled) {
              // Logged, because the button simply not appearing is
              // indistinguishable from the feature being off. Square throws
              // here for several unrelated reasons - the browser cannot do
              // Apple Pay, the device has no card in Wallet, the domain is
              // not verified with Square - and only the error says which.
              console.warn('Apple Pay unavailable', applePayError);
              applePayRef.current = null;
              setWalletSupport((current) => ({ ...current, applePay: false }));
            }
          }
        }

        if (config.enableGooglePay) {
          try {
            const googlePay = await payments.googlePay(paymentRequest);
            walletInstances.push(googlePay);

            // The container is rendered by the branch above, but this effect
            // can reach here before React has painted it - so wait for it
            // rather than assuming. Without this the fix above would work or
            // not depending on timing, which is worse than failing outright.
            googlePayContainer = await waitForElement(googlePayContainerId.current);

            if (!googlePayContainer) {
              throw new Error('The Google Pay container was never rendered.');
            }

            // Square's defaults for these are undocumented, and what they
            // actually produce is a narrow, icon-only button: 'short' draws
            // the bare G Pay mark with no wording, and 'static' sizes the
            // button to its own content instead of the container. Beside a
            // full-width Apple Pay bar that reads as a different, lesser
            // control. 'long' is the variant whose face carries the wording,
            // and 'fill' is what makes it span the card.
            await googlePay.attach(`#${googlePayContainerId.current}`, {
              buttonColor: 'black',
              buttonRadius: 6,
              buttonSizeMode: 'fill',
              buttonType: 'long'
            });

            googlePayClickHandler = (clickEvent) => {
              clickEvent.preventDefault();
              handleWalletPayment(googlePay, 'Google Pay');
            };
            googlePayContainer?.addEventListener('click', googlePayClickHandler);

            if (!cancelled) {
              setWalletSupport((current) => ({ ...current, googlePay: true }));
            }
          } catch (googlePayError) {
            if (!cancelled) {
              // Logged for the same reason Apple Pay's failure is: a wallet
              // button that never appears is indistinguishable from one that
              // was switched off, and this catch swallowed the attach failure
              // silently for as long as it existed.
              console.warn('Google Pay unavailable', googlePayError);
              setWalletSupport((current) => ({ ...current, googlePay: false }));
            }
          }
        }
      } catch (squareLoadError) {
        if (!cancelled) {
          // Logged with the whole object, not just the message. Square's own
          // wording here - "An unexpected error occurred while using Card" -
          // says nothing about which call failed or why, and the useful part
          // is on the error rather than in its text. Without this a report of
          // it leaves nothing to work from, which is exactly what happened
          // the first time it was raised.
          console.error('Square payment form failed to initialize', squareLoadError);
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

      // Handed to the next run rather than fired and forgotten.
      teardownRef.current = Promise.allSettled([
        destroyPaymentMethod(cardInstance),
        ...walletInstances.map(destroyPaymentMethod)
      ]);
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
          {/* Google Pay renders ITSELF into this container, so the container
              has to be on the page before googlePay.attach() is called. It
              used to be rendered only once walletSupport.googlePay was true -
              which is set only after that same attach succeeds. Nothing could
              ever satisfy both, so attach always failed against a container
              that did not exist and Google Pay never appeared in any browser.
              It looked Firefox-specific only because that is where someone
              went looking.

              Hence the tri-state: while googlePay is null the container is on
              the page, empty and sized by its own min-height, waiting to be
              attached to. It is removed only once setup has actually failed.
              It must be genuinely rendered rather than hidden or off-screen -
              Square refuses a container it cannot measure, which is the same
              trap that made an isolated Apple Pay probe fail earlier. */}
          {walletSupport.applePay || walletSupport.googlePay !== false ? (
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
              {walletSupport.googlePay !== false ? (
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
// Returns the teardown promise so a caller can wait for it. Square's destroy()
// is asynchronous: it tears down an iframe inside the container, and attaching
// a new card before that finishes is what raises "An unexpected error occurred
// while using Card". Callers that do not care may ignore the return value.
function destroyPaymentMethod(paymentMethod) {
  if (!paymentMethod || typeof paymentMethod.destroy !== 'function') {
    return Promise.resolve();
  }

  try {
    return Promise.resolve(paymentMethod.destroy()).catch(() => {});
  } catch {
    // Discarded regardless.
    return Promise.resolve();
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

// Waits for an element React is about to paint. Square attaches its wallet
// button by selector, so the node has to exist first; this effect can reach
// that call in the same tick the container is rendered. Polls per animation
// frame rather than using a fixed delay, so it costs nothing when the node is
// already there and does not race on a slow machine. Returns null rather than
// throwing, so the caller decides what a missing container means.
async function waitForElement(elementId, maxFrames = 60) {
  for (let frame = 0; frame < maxFrames; frame += 1) {
    const element = document.getElementById(elementId);

    if (element) {
      return element;
    }

    await new Promise((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  }

  return document.getElementById(elementId);
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
