import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { updateProfile } from 'firebase/auth';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { db, firebaseConfigured } from '../lib/firebase.js';

function ProfilePage() {
  const { currentUser, loading, profileError, userProfile } = useAuth();
  const [formError, setFormError] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    setName(userProfile?.name || currentUser?.displayName || '');
    setPhone(userProfile?.phone || '');
  }, [currentUser, userProfile]);

  if (!firebaseConfigured) {
    return (
      <div className="empty-state">
        <h2>Firebase is not configured</h2>
        <p>Add the Firebase environment variables before using profiles.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="empty-state">
        <h2>Loading Profile</h2>
        <p>Retrieving your account details.</p>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: { pathname: '/profile' } }} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');
    setSuccessMessage('');

    if (!name.trim()) {
      setFormError('Name is required.');
      return;
    }

    setSaving(true);

    try {
      const displayName = toTitleCase(name);
      await updateProfile(currentUser, { displayName });
      await updateDoc(doc(db, 'users', currentUser.uid), {
        email: currentUser.email || userProfile?.email || '',
        name: displayName,
        phone: phone.trim(),
        updatedDate: serverTimestamp()
      });
      setSuccessMessage('Profile saved.');
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Account"
        title="My Profile"
        description="Update your member profile information."
      />
      {profileError ? (
        <div className="empty-state">
          <h2>Profile Needed</h2>
          <p>{profileError}</p>
          <Link className="button-link" to="/signup">
            Create Account
          </Link>
        </div>
      ) : (
        <form className="form-panel" onSubmit={handleSubmit}>
          <label>
            <span>Name *</span>
            <input
              autoComplete="name"
              disabled={saving}
              onBlur={(event) => setName(toTitleCase(event.target.value))}
              onChange={(event) => setName(event.target.value)}
              required
              value={name}
            />
          </label>
          <label>
            <span>Email</span>
            <input disabled readOnly value={currentUser.email || userProfile?.email || ''} />
            <span className="form-help">Email changes are handled separately.</span>
          </label>
          <label>
            <span>Phone</span>
            <input
              autoComplete="tel"
              disabled={saving}
              onChange={(event) => setPhone(event.target.value)}
              type="tel"
              value={phone}
            />
          </label>
          {formError ? <p className="form-error">{formError}</p> : null}
          {successMessage ? <p className="form-success">{successMessage}</p> : null}
          <button className="button-link button-reset" disabled={saving} type="submit">
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </form>
      )}
    </section>
  );
}

function toTitleCase(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

export default ProfilePage;
