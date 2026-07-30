import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import RegistrationPaymentPanel from '../components/RegistrationPaymentPanel.jsx';
import { getSquareTokenizeError } from '../hooks/usePaymentReservation.js';
import { claimWaitlistOffer, loadSquarePaymentConfig } from '../services/registrationService.js';
import { formatCurrency } from '../utils/eventFormat.js';

// Reachable with no sign-in - the emailed claim link's own token is what
// authorizes this page, same magic-link design as the login-recovery flow.
// A bare page load never claims anything: the "peek" request below only
// ever reveals what's owed, and either branch (free/cash-check confirm, or
// a real Square token) requires the member to act first.
function WaitlistClaimPage() {
  const [searchParams] = useSearchParams();
  const registrationId = searchParams.get('registrationId') || '';
  const token = searchParams.get('token') || '';
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [offer, setOffer] = useState(null);
  const [claimed, setClaimed] = useState(false);
  const [claimError, setClaimError] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [squareConfig, setSquareConfig] = useState(null);
  const [squareCard, setSquareCard] = useState(null);
  const [squareWalletToken, setSquareWalletToken] = useState('');
  const [squareError, setSquareError] = useState('');
  const [submittingPayment, setSubmittingPayment] = useState(false);

  useEffect(() => {
    if (!registrationId || !token) {
      setLoadError('This claim link is invalid.');
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const result = await claimWaitlistOffer({ registrationId, token });

        if (cancelled) {
          return;
        }

        setOffer(result);

        if (result.paymentRequired) {
          try {
            setSquareConfig(await loadSquarePaymentConfig());
          } catch (configError) {
            if (!cancelled) {
              setSquareError(configError.message);
            }
          }
        }
      } catch (error) {
        if (!cancelled) {
          setLoadError(error.message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [registrationId, token]);

  const handleConfirmFreeSpot = useCallback(async () => {
    setClaimError('');
    setConfirming(true);

    try {
      await claimWaitlistOffer({ confirmed: true, registrationId, token });
      setClaimed(true);
    } catch (error) {
      setClaimError(error.message);
    } finally {
      setConfirming(false);
    }
  }, [registrationId, token]);

  const handleSubmitPayment = useCallback(async (event) => {
    event.preventDefault();
    setClaimError('');
    setSubmittingPayment(true);

    try {
      const squarePaymentToken = squareWalletToken || await tokenizeCard(squareCard, offer?.amountDue);

      await claimWaitlistOffer({ registrationId, squarePaymentToken, token });
      setClaimed(true);
    } catch (error) {
      setClaimError(error.message);
    } finally {
      setSubmittingPayment(false);
    }
  }, [offer, registrationId, squareCard, squareWalletToken, token]);

  if (loading) {
    return (
      <section>
        <PageHeader eyebrow="Waitlist" title="Claim Your Spot" />
        <p className="form-help">Checking your offer...</p>
      </section>
    );
  }

  if (loadError) {
    return (
      <section>
        <PageHeader eyebrow="Waitlist" title="Claim Your Spot" />
        <div className="empty-state">
          <h2>This Offer Isn&apos;t Available</h2>
          <p>{loadError}</p>
          <Link className="button-link" to="/events">
            Browse Events
          </Link>
        </div>
      </section>
    );
  }

  if (claimed) {
    return (
      <section>
        <PageHeader eyebrow="Waitlist" title="You're Registered!" />
        <div className="status-panel">
          <span className="status-dot" />
          <span>
            Your spot for {offer?.eventTitle || 'this event'} is confirmed. A confirmation email is on its way.
          </span>
        </div>
        <Link className="button-link" to="/my-registrations">
          View My Registrations
        </Link>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow="Waitlist"
        title="Claim Your Spot"
        description={`A seat opened up for ${offer?.eventTitle || 'this event'}.`}
      />
      {claimError ? <p className="form-error">{claimError}</p> : null}
      {!offer?.paymentRequired ? (
        <button
          className="button-link button-reset"
          disabled={confirming}
          type="button"
          onClick={handleConfirmFreeSpot}
        >
          {confirming ? 'Confirming...' : 'Confirm My Spot'}
        </button>
      ) : (
        <form className="form-panel" onSubmit={handleSubmitPayment}>
          <RegistrationPaymentPanel
            amountDue={offer?.amountDue || 0}
            config={squareConfig}
            disabled={submittingPayment}
            error={squareError}
            onCardReady={setSquareCard}
            onEnsureReservation={() => Promise.resolve()}
            onWalletTokenReady={setSquareWalletToken}
            onlinePaymentRequired
            selectedPaymentToken={squareWalletToken}
          />
          <button className="button-link button-reset" disabled={submittingPayment} type="submit">
            {submittingPayment ? 'Submitting...' : `Pay ${formatCurrency(offer?.amountDue || 0)} & Claim My Spot`}
          </button>
        </form>
      )}
    </section>
  );
}

async function tokenizeCard(squareCard, amountDue) {
  if (!squareCard) {
    throw new Error('Card payment is not ready yet.');
  }

  const tokenResult = await squareCard.tokenize({
    amount: Number(amountDue || 0).toFixed(2),
    currencyCode: 'USD',
    intent: 'CHARGE'
  });

  if (tokenResult.status !== 'OK') {
    throw new Error(getSquareTokenizeError(tokenResult));
  }

  return tokenResult.token;
}

export default WaitlistClaimPage;
