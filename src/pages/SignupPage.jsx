import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import PageHeader from '../components/PageHeader.jsx';
import { DEFAULT_USER_PERMISSIONS } from '../data/userRoles.js';
import { auth, db, firebaseConfigured } from '../lib/firebase.js';

function SignupPage() {
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');

    if (!name.trim()) {
      setFormError('Name is required.');
      return;
    }

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }

    setSubmitting(true);

    try {
      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      const user = userCredential.user;
      const displayName = toTitleCase(name);

      await updateProfile(user, { displayName });
      await setDoc(doc(db, 'users', user.uid), {
        createdDate: serverTimestamp(),
        email: email.trim(),
        name: displayName,
        permissions: DEFAULT_USER_PERMISSIONS,
        phone: phone.trim(),
        role: 'General User',
        status: 'Active',
        updatedDate: serverTimestamp(),
        userId: user.uid
      });

      navigate('/events', { replace: true });
    } catch (error) {
      setFormError(getSignupErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Account"
        title="Create Account"
        description="Create a member account for event registration and future account features."
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
          <span>Name *</span>
          <input
            autoComplete="name"
            disabled={!firebaseConfigured || submitting}
            onBlur={(event) => setName(toTitleCase(event.target.value))}
            onChange={(event) => setName(event.target.value)}
            required
            value={name}
          />
        </label>
        <label>
          <span>Email *</span>
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
          <span>Phone</span>
          <input
            autoComplete="tel"
            disabled={!firebaseConfigured || submitting}
            onChange={(event) => setPhone(event.target.value)}
            type="tel"
            value={phone}
          />
        </label>
        <label>
          <span>Password *</span>
          <input
            autoComplete="new-password"
            disabled={!firebaseConfigured || submitting}
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
          <span className="form-help">Use at least 8 characters.</span>
        </label>
        {formError ? <p className="form-error">{formError}</p> : null}
        <button
          className="button-link button-reset"
          disabled={!firebaseConfigured || submitting}
          type="submit"
        >
          {submitting ? 'Creating Account...' : 'Create Account'}
        </button>
      </form>
    </section>
  );
}

function toTitleCase(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function getSignupErrorMessage(error) {
  if (error.code === 'auth/email-already-in-use') {
    return 'An account already exists for this email.';
  }

  if (error.code === 'auth/weak-password') {
    return 'Password must be at least 8 characters.';
  }

  return error.message;
}

export default SignupPage;
