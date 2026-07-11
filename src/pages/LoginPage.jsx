import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { auth } from '../lib/firebase.js';

function LoginPage() {
  const { currentUser, firebaseConfigured, isAdmin, loading, logOut, profileError } =
    useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const destination = location.state?.from?.pathname || '/admin';

  if (!loading && currentUser && isAdmin) {
    return <Navigate to={destination} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setSubmitting(true);

    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      navigate(destination, { replace: true });
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Authentication"
        title="Administrator login"
        description="Sign in with an active administrator account to manage events, registrations, attendance, and reports."
      />
      <div className="status-panel">
        <span className={firebaseConfigured ? 'status-dot good' : 'status-dot'} />
        <span>
          Firebase environment configuration is{' '}
          <strong>{firebaseConfigured ? 'present' : 'not set locally'}</strong>.
        </span>
      </div>
      {currentUser && !isAdmin ? (
        <div className="empty-state">
          <h2>Admin profile needed</h2>
          <p>
            {profileError ||
              'You are signed in, but this account is not an active administrator.'}
          </p>
          <button className="button-link button-reset" type="button" onClick={logOut}>
            Sign out
          </button>
        </div>
      ) : (
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
      )}
    </section>
  );
}

export default LoginPage;
