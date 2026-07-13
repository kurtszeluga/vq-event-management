import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { sendPasswordResetEmail, signInWithEmailAndPassword } from 'firebase/auth';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { auth } from '../lib/firebase.js';

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
      setFormError(error.message);
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

  return (
    <section>
      <PageHeader
        eyebrow="Authentication"
        title="Sign in"
        description="Sign in to access your account, member features, and any tools you are allowed to use."
      />
      <div className="status-panel">
        <span className={firebaseConfigured ? 'status-dot good' : 'status-dot'} />
        <span>
          Firebase environment configuration is{' '}
          <strong>{firebaseConfigured ? 'present' : 'not set locally'}</strong>.
        </span>
      </div>
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
            Need an account? <Link to="/signup">Create one here.</Link>
          </span>
      </form>
    </section>
  );
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
