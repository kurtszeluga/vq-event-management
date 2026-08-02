import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { signInWithCustomToken, signInWithEmailAndPassword } from 'firebase/auth';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { auth } from '../lib/firebase.js';
import { startAccountRecovery, verifyAccountRecoveryCode } from '../services/accountRecoveryService.js';
import { formatPhoneNumber } from '../utils/profileFormat.js';

// The single recovery field takes either an email or a phone number, so it
// can only live-format as a phone once the digits typed so far couldn't be
// anything else - as soon as a letter or "@" shows up, formatting stops and
// the raw text (email) passes through untouched.
function formatRecoveryIdentifier(rawValue) {
  const digitsOnly = rawValue.replace(/[\s().-]/g, '');
  const looksLikePhone = digitsOnly.length > 0 && /^\d+$/.test(digitsOnly);

  return looksLikePhone ? formatPhoneNumber(rawValue) : rawValue;
}

function LoginPage() {
  const { currentUser, firebaseConfigured, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryIdentifier, setRecoveryIdentifier] = useState('');
  const [recoveryChallengeId, setRecoveryChallengeId] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [sendingCode, setSendingCode] = useState(false);
  const [verifyingCode, setVerifyingCode] = useState(false);
  // Counts only wrong-credential failures, so a network blip or a typo'd
  // email address does not push someone toward the recovery code.
  const [failedAttempts, setFailedAttempts] = useState(0);
  const navigate = useNavigate();

  if (!loading && currentUser) {
    return <Navigate to="/" replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      setFailedAttempts(0);
      navigate('/', { replace: true });
    } catch (error) {
      const attempts = isWrongCredentialError(error) ? failedAttempts + 1 : failedAttempts;

      setFailedAttempts(attempts);
      setFormError(getSignInErrorMessage(error, attempts));
    } finally {
      setSubmitting(false);
    }
  }

  function resetRecoveryState() {
    setRecoveryIdentifier('');
    setRecoveryChallengeId('');
    setRecoveryCode('');
    setRecoveryError('');
    setRecoveryMessage('');
  }

  async function handleSendRecoveryCode() {
    setRecoveryError('');
    setRecoveryMessage('');
    setRecoveryCode('');

    if (!recoveryIdentifier.trim()) {
      setRecoveryError('Enter your email address or phone number.');
      return;
    }

    setSendingCode(true);

    try {
      const result = await startAccountRecovery(recoveryIdentifier.trim());
      setRecoveryChallengeId(result.challengeId || '');
      setRecoveryMessage(result.message);
    } catch (error) {
      setRecoveryError(error.message);
    } finally {
      setSendingCode(false);
    }
  }

  async function handleVerifyRecoveryCode() {
    setRecoveryError('');

    if (!recoveryChallengeId || !/^\d{6}$/.test(recoveryCode)) {
      setRecoveryError('Enter the six-digit verification code from your email.');
      return;
    }

    setVerifyingCode(true);

    try {
      const result = await verifyAccountRecoveryCode({ challengeId: recoveryChallengeId, code: recoveryCode });
      await signInWithCustomToken(auth, result.customToken);
      navigate('/profile?passwordReset=1', { replace: true });
    } catch (error) {
      setRecoveryError(error.message);
    } finally {
      setVerifyingCode(false);
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Authentication"
        title="Sign in"
        description="Sign in to access your account, member features, and any tools you are allowed to use."
      />
      {!firebaseConfigured ? (
        <div className="status-panel">
          <span className="status-dot" />
          <span>Sign-in isn&apos;t available right now. Please try again later or contact support.</span>
        </div>
      ) : null}
      <form className="form-panel" onSubmit={handleSubmit}>
          {!recoveryOpen ? (
            <>
              <label>
                <span>Email</span>
                <input
                  autoComplete="email"
                  disabled={!firebaseConfigured || submitting}
                  onChange={(event) => {
                    // Failures belong to the address that produced them.
                    setEmail(event.target.value);
                    setFailedAttempts(0);
                  }}
                  required
                  type="email"
                  value={email}
                />
                <span className="form-help">
                  Your username is the email address used for your account.
                </span>
              </label>
              <label>
                <span>Password</span>
                <input
                  autoComplete="current-password"
                  disabled={!firebaseConfigured || submitting}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
              </label>
            </>
          ) : null}
          <div className="login-recovery">
            <button
              className="text-button"
              disabled={!firebaseConfigured || submitting}
              type="button"
              onClick={() => {
                setRecoveryOpen((current) => !current);
                resetRecoveryState();
              }}
            >
              Forgot password or username?
            </button>
            {recoveryOpen ? (
              <div className="login-recovery-panel">
                {!recoveryChallengeId ? (
                  <>
                    <p>
                      Enter the email address or phone number on your account.
                      If we find a match, we&apos;ll email you a verification code.
                    </p>
                    <label>
                      <span>Email or phone number</span>
                      <input
                        autoComplete="username"
                        disabled={!firebaseConfigured || sendingCode}
                        onChange={(event) => setRecoveryIdentifier(formatRecoveryIdentifier(event.target.value))}
                        type="text"
                        value={recoveryIdentifier}
                      />
                    </label>
                    {recoveryError ? (
                      <p className="form-error">{recoveryError}</p>
                    ) : null}
                    <button
                      className="button-link button-reset secondary-action"
                      disabled={!firebaseConfigured || sendingCode}
                      type="button"
                      onClick={handleSendRecoveryCode}
                    >
                      {sendingCode ? 'Sending...' : 'Send Code'}
                    </button>
                  </>
                ) : (
                  <>
                    {recoveryMessage ? (
                      <p className="form-success">{recoveryMessage}</p>
                    ) : null}
                    <label>
                      <span>Verification code</span>
                      <input
                        autoComplete="one-time-code"
                        disabled={verifyingCode}
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(event) => setRecoveryCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        type="text"
                        value={recoveryCode}
                      />
                    </label>
                    {recoveryError ? (
                      <p className="form-error">{recoveryError}</p>
                    ) : null}
                    <button
                      className="button-link button-reset secondary-action"
                      disabled={verifyingCode}
                      type="button"
                      onClick={handleVerifyRecoveryCode}
                    >
                      {verifyingCode ? 'Verifying...' : 'Verify & Sign In'}
                    </button>
                    <button
                      className="text-button"
                      disabled={verifyingCode}
                      type="button"
                      onClick={resetRecoveryState}
                    >
                      Start over
                    </button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          {!recoveryOpen ? (
            <>
              {formError ? <p className="form-error">{formError}</p> : null}
              <button
                className="button-link button-reset"
                disabled={!firebaseConfigured || submitting}
                type="submit"
              >
                {submitting ? 'Signing in...' : 'Sign in'}
              </button>
            </>
          ) : null}
          <span className="form-help">
            Not a Guild member? <Link to="/signup">Join the Village Quilters today →</Link>
          </span>
      </form>
    </section>
  );
}

function isWrongCredentialError(error) {
  return error.code === 'auth/invalid-credential'
    || error.code === 'auth/wrong-password'
    || error.code === 'auth/user-not-found';
}

function getSignInErrorMessage(error, failedAttempts = 0) {
  if (isWrongCredentialError(error)) {
    // A first wrong password is usually a typo, so it just says to try again.
    // Only from the second failure is the verification code worth raising -
    // offering it immediately reads as though retrying is not an option.
    return failedAttempts > 1
      ? 'That email and password combination is not correct. Try again, or use Forgot password or username below to sign in with a verification code.'
      : 'That email and password combination is not correct. Please try again.';
  }

  if (error.code === 'auth/invalid-email') {
    return 'Enter a valid email address.';
  }

  if (error.code === 'auth/user-disabled') {
    return 'This account has been disabled. Contact an administrator for help.';
  }

  if (error.code === 'auth/too-many-requests') {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }

  if (error.code === 'auth/network-request-failed') {
    return 'Could not connect. Check your internet connection and try again.';
  }

  return 'Sign in could not be completed. Please try again.';
}

export default LoginPage;
