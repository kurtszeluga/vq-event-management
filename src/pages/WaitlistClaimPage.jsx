import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import PageHeader from '../components/PageHeader.jsx';
import RegistrationPaymentPanel from '../components/RegistrationPaymentPanel.jsx';
import { getSquareTokenizeError } from '../hooks/usePaymentReservation.js';
import {
  claimWaitlistOffer,
  declineWaitlistOffer,
  loadSquarePaymentConfig
} from '../services/registrationService.js';
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
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [declineError, setDeclineError] = useState('');

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

  async function handleDecline() {
    setDeclineError('');
    setDeclining(true);

    try {
      await declineWaitlistOffer({ registrationId, token });
      setDeclineOpen(false);
      setDeclined(true);
    } catch (error) {
      // Left open with the reason inside it rather than closing on someone
      // who would then have no idea what happened, matching how the
      // registration password dialog handles a failure.
      setDeclineError(error.message);
    } finally {
      setDeclining(false);
    }
  }

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

  if (declined) {
    return (
      <section>
        <PageHeader eyebrow="Waitlist" title="Thanks For Letting Us Know" />
        <div className="status-panel">
          <span className="status-dot" />
          <span>
            Your spot for {offer?.eventTitle || 'this event'} has been passed to the next person on the
            waitlist, and you have been taken off the list for it.
          </span>
        </div>
        <Link className="button-link" to="/events">
          Browse Events
        </Link>
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
      {/* Outside the payment form on purpose - inside it, declining would be a
          second submit button competing with Pay & Claim, and Enter in the
          card fields could reach the wrong one. */}
      <div className="waitlist-decline-row">
        <p className="form-help">Can&apos;t make it? Letting us know frees the seat for the next person straight away.</p>
        <button
          className="text-button"
          disabled={confirming || submittingPayment}
          type="button"
          onClick={() => {
            setDeclineError('');
            setDeclineOpen(true);
          }}
        >
          No Thanks, Give It To Someone Else
        </button>
      </div>
      <ConfirmDialog
        busy={declining}
        cancelLabel="Keep My Offer"
        confirmLabel="Yes, Give It Up"
        description={`This gives your spot for ${offer?.eventTitle || 'this event'} to the next person on the waitlist and takes you off the list for it. You can register again later if seats are still open, but you will not keep your place in the queue.`}
        error={declineError}
        onCancel={declining ? undefined : () => setDeclineOpen(false)}
        onConfirm={handleDecline}
        open={declineOpen}
        title="Give Up This Spot?"
        tone="danger"
      />
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
