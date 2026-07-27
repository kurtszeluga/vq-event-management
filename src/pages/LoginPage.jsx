import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { auth } from '../lib/firebase.js';
import { startPhoneRecovery, verifyPhoneRecoveryCode } from '../services/accountRecoveryService.js';
import { formatPhoneNumber } from '../utils/profileFormat.js';

function LoginPage() {
  const { currentUser, firebaseConfigured, loading } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [phoneChallengeId, setPhoneChallengeId] = useState('');
  const [phoneCode, setPhoneCode] = useState('');
  const [phoneRecoveryError, setPhoneRecoveryError] = useState('');
  const [phoneRecoveryMessage, setPhoneRecoveryMessage] = useState('');
  const [sendingPhoneCode, setSendingPhoneCode] = useState(false);
  const [verifyingPhoneCode, setVerifyingPhoneCode] = useState(false);
  const [recoveredEmail, setRecoveredEmail] = useState('');
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
      navigate('/', { replace: true });
    } catch (error) {
      setFormError(getSignInErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordReset() {
    const resetEmail = email.trim();
    setRecoveryError('');
    setRecoveryMessage('');

    if (!resetEmail) {
      setRecoveryError('Enter your email address above first.');
      return;
    }

    setSendingReset(true);

    try {
      await sendPasswordResetEmail(auth, resetEmail);
      setRecoveryMessage(
        'If that email has an account, Firebase will send password reset instructions.'
      );
    } catch (error) {
      setRecoveryError(getPasswordResetErrorMessage(error));
    } finally {
      setSendingReset(false);
    }
  }

  function resetPhoneRecoveryState() {
    setPhoneChallengeId('');
    setPhoneCode('');
    setPhoneRecoveryError('');
    setPhoneRecoveryMessage('');
    setRecoveredEmail('');
  }

  async function handleStartPhoneRecovery() {
    setPhoneRecoveryError('');
    setPhoneRecoveryMessage('');
    setRecoveredEmail('');
    setPhoneCode('');

    if (recoveryPhone.replace(/\D/g, '').length !== 10) {
      setPhoneRecoveryError('Enter a valid 10-digit phone number.');
      return;
    }

    setSendingPhoneCode(true);

    try {
      const result = await startPhoneRecovery(recoveryPhone);
      setPhoneChallengeId(result.challengeId || '');
      setPhoneRecoveryMessage(result.message);
    } catch (error) {
      setPhoneRecoveryError(error.message);
    } finally {
      setSendingPhoneCode(false);
    }
  }

  async function handleVerifyPhoneCode() {
    setPhoneRecoveryError('');

    if (!phoneChallengeId || !/^\d{6}$/.test(phoneCode)) {
      setPhoneRecoveryError('Enter the six-digit verification code from your email.');
      return;
    }

    setVerifyingPhoneCode(true);

    try {
      const result = await verifyPhoneRecoveryCode({ challengeId: phoneChallengeId, code: phoneCode });
      setRecoveredEmail(result.email);
      setPhoneRecoveryMessage('');
      setEmail(result.email);
    } catch (error) {
      setPhoneRecoveryError(error.message);
    } finally {
      setVerifyingPhoneCode(false);
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
          <label>
            <span>Email</span>
            <input
              autoComplete="email"
              disabled={!firebaseConfigured || submitting}
              onChange={(event) => setEmail(event.target.value)}
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
          <div className="login-recovery">
            <button
              className="text-button"
              disabled={!firebaseConfigured || submitting}
              type="button"
              onClick={() => {
                setRecoveryOpen((current) => !current);
                setRecoveryError('');
                setRecoveryMessage('');
                setRecoveryPhone('');
                resetPhoneRecoveryState();
              }}
            >
              Forgot password or username?
            </button>
            {recoveryOpen ? (
              <div className="login-recovery-panel">
                <p>
                  Your username is your email address. To reset your password,
                  enter your email above and send reset instructions.
                </p>
                {recoveryError ? (
                  <p className="form-error">{recoveryError}</p>
                ) : null}
                {recoveryMessage ? (
                  <p className="form-success">{recoveryMessage}</p>
                ) : null}
                <button
                  className="button-link button-reset secondary-action"
                  disabled={!firebaseConfigured || sendingReset}
                  type="button"
                  onClick={handlePasswordReset}
                >
                  {sendingReset ? 'Sending...' : 'Send Password Reset Email'}
                </button>
                <p>
                  Forgot your email address? Enter the phone number on your
                  account and we&apos;ll email a verification code to the
                  address on file.
                </p>
                <label>
                  <span>Phone number</span>
                  <input
                    autoComplete="tel"
                    disabled={!firebaseConfigured || sendingPhoneCode}
                    onChange={(event) => setRecoveryPhone(formatPhoneNumber(event.target.value))}
                    type="tel"
                    value={recoveryPhone}
                  />
                </label>
                {phoneRecoveryError ? (
                  <p className="form-error">{phoneRecoveryError}</p>
                ) : null}
                {phoneRecoveryMessage ? (
                  <p className="form-success">{phoneRecoveryMessage}</p>
                ) : null}
                {recoveredEmail ? (
                  <p className="form-success">
                    Your account email is <strong>{recoveredEmail}</strong>.
                    We&apos;ve filled it in above &mdash; enter your password
                    or send a password reset email.
                  </p>
                ) : null}
                {!recoveredEmail ? (
                  <button
                    className="button-link button-reset secondary-action"
                    disabled={!firebaseConfigured || sendingPhoneCode}
                    type="button"
                    onClick={handleStartPhoneRecovery}
                  >
                    {sendingPhoneCode ? 'Sending...' : 'Send Verification Code'}
                  </button>
                ) : null}
                {phoneChallengeId && !recoveredEmail ? (
                  <>
                    <label>
                      <span>Verification code</span>
                      <input
                        autoComplete="one-time-code"
                        disabled={verifyingPhoneCode}
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                        type="text"
                        value={phoneCode}
                      />
                    </label>
                    <button
                      className="button-link button-reset secondary-action"
                      disabled={verifyingPhoneCode}
                      type="button"
                      onClick={handleVerifyPhoneCode}
                    >
                      {verifyingPhoneCode ? 'Verifying...' : 'Verify Code'}
                    </button>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
          {formError ? <p className="form-error">{formError}</p> : null}
          <button
            className="button-link button-reset"
            disabled={!firebaseConfigured || submitting}
            type="submit"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>
          <span className="form-help">
            Need to become a member? <Link to="/signup">Start here.</Link>
          </span>
      </form>
    </section>
  );
}

function getSignInErrorMessage(error) {
  if (error.code === 'auth/invalid-credential'
    || error.code === 'auth/wrong-password'
    || error.code === 'auth/user-not-found') {
    return 'That email and password combination is not correct. Try again, or use Forgot password or username below.';
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

function getPasswordResetErrorMessage(error) {
  if (error.code === 'auth/invalid-email') {
    return 'Enter a valid email address.';
  }

  if (error.code === 'auth/too-many-requests') {
    return 'Too many attempts. Please wait a few minutes and try again.';
  }

  return 'Password reset could not be started. Please check the email address and try again.';
}

export default LoginPage;
