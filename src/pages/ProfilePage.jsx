import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import {
  updatePassword,
  updateProfile
} from 'firebase/auth';
import { doc, serverTimestamp, updateDoc } from 'firebase/firestore';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { USER_PERMISSION_OPTIONS, normalizePermissions } from '../data/userRoles.js';
import { US_STATES } from '../data/usStates.js';
import { db, firebaseConfigured } from '../lib/firebase.js';
import {
  buildDisplayName,
  buildBillingAddress,
  formatPhoneNumber,
  getProfileFirstName,
  getProfileLastName,
  toTitleCase
} from '../utils/profileFormat.js';

function ProfilePage() {
  const { currentUser, loading, profileError, userProfile } = useAuth();
  const [billingCity, setBillingCity] = useState('');
  const [billingCountry, setBillingCountry] = useState('United States');
  const [billingPostalCode, setBillingPostalCode] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingStreet, setBillingStreet] = useState('');
  const [firstName, setFirstName] = useState('');
  const [formError, setFormError] = useState('');
  const [lastName, setLastName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccessMessage, setPasswordSuccessMessage] = useState('');
  const [phone, setPhone] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const resetProfileForm = useCallback(() => {
    const billingAddress = userProfile?.billingAddress || {};

    setBillingCity(billingAddress.city || '');
    setBillingCountry(billingAddress.country || 'United States');
    setBillingPostalCode(billingAddress.postalCode || '');
    setBillingState(billingAddress.state || '');
    setBillingStreet(billingAddress.street || '');
    setFirstName(getProfileFirstName(userProfile) || getProfileFirstName({ name: currentUser?.displayName || '' }));
    setLastName(getProfileLastName(userProfile) || getProfileLastName({ name: currentUser?.displayName || '' }));
    setPhone(userProfile?.phone || '');
    setFormError('');
    setSuccessMessage('');
  }, [currentUser, userProfile]);

  useEffect(() => {
    resetProfileForm();
  }, [resetProfileForm]);

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

    if (!firstName.trim() || !lastName.trim()) {
      setFormError('First name and last name are required.');
      return;
    }

    setSaving(true);

    try {
      const formattedFirstName = toTitleCase(firstName);
      const formattedLastName = toTitleCase(lastName);
      const displayName = buildDisplayName(formattedFirstName, formattedLastName);
      await updateProfile(currentUser, { displayName });
      await updateDoc(doc(db, 'users', currentUser.uid), {
        billingAddress: buildBillingAddress({
          city: billingCity,
          country: billingCountry,
          postalCode: billingPostalCode,
          state: billingState,
          street: billingStreet
        }),
        email: currentUser.email || userProfile?.email || '',
        firstName: formattedFirstName,
        lastName: formattedLastName,
        name: displayName,
        phone: formatPhoneNumber(phone),
        updatedDate: serverTimestamp()
      });
      setSuccessMessage('Profile saved.');
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault();
    setPasswordError('');
    setPasswordSuccessMessage('');

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match.');
      return;
    }

    setSavingPassword(true);

    try {
      await updatePassword(currentUser, newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccessMessage('Password changed.');
    } catch (error) {
      setPasswordError(getPasswordErrorMessage(error));
    } finally {
      setSavingPassword(false);
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
            Become A Member
          </Link>
        </div>
      ) : (
        <>
          {userProfile?.role === 'Admin' || userProfile?.role === 'Super User' ? (
            <div className="status-panel">
              <span className="status-dot good" />
              <span>
                <strong>{userProfile.role}</strong> permissions:{' '}
                {userProfile.role === 'Super User'
                  ? 'All Permissions'
                  : getPermissionSummary(normalizePermissions(userProfile.permissions))}
              </span>
            </div>
          ) : null}
          <form className="form-panel" onSubmit={handleSubmit}>
          <label>
            <span>First Name *</span>
            <input
              autoComplete="given-name"
              disabled={saving}
              onBlur={(event) => setFirstName(toTitleCase(event.target.value))}
              onChange={(event) => setFirstName(event.target.value)}
              required
              value={firstName}
            />
          </label>
          <label>
            <span>Last Name *</span>
            <input
              autoComplete="family-name"
              disabled={saving}
              onBlur={(event) => setLastName(toTitleCase(event.target.value))}
              onChange={(event) => setLastName(event.target.value)}
              required
              value={lastName}
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
              onChange={(event) => setPhone(formatPhoneNumber(event.target.value))}
              type="tel"
              value={phone}
            />
          </label>
          <div className="form-subsection compact-subsection">
            <h3>Billing Address</h3>
            <label>
              <span>Street Address</span>
              <input
                autoComplete="billing street-address"
                disabled={saving}
                onBlur={(event) => setBillingStreet(toTitleCase(event.target.value))}
                onChange={(event) => setBillingStreet(event.target.value)}
                value={billingStreet}
              />
            </label>
            <label>
              <span>City</span>
              <input
                autoComplete="billing address-level2"
                disabled={saving}
                onBlur={(event) => setBillingCity(toTitleCase(event.target.value))}
                onChange={(event) => setBillingCity(event.target.value)}
                value={billingCity}
              />
            </label>
            <label>
              <span>State</span>
              <select
                autoComplete="billing address-level1"
                disabled={saving}
                onChange={(event) => setBillingState(event.target.value)}
                value={billingState}
              >
                <option value="">Select State</option>
                {US_STATES.map((state) => (
                  <option key={state.value} value={state.value}>
                    {state.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>ZIP Code</span>
              <input
                autoComplete="billing postal-code"
                disabled={saving}
                onChange={(event) => setBillingPostalCode(event.target.value)}
                value={billingPostalCode}
              />
            </label>
            <label>
              <span>Country</span>
              <input
                autoComplete="billing country-name"
                disabled={saving}
                onBlur={(event) => setBillingCountry(toTitleCase(event.target.value))}
                onChange={(event) => setBillingCountry(event.target.value)}
                value={billingCountry}
              />
            </label>
          </div>
          {formError ? <p className="form-error">{formError}</p> : null}
          {successMessage ? <p className="form-success">{successMessage}</p> : null}
          <div className="form-actions">
            <button className="button-link button-reset" disabled={saving} type="submit">
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
            <button
              className="button-link button-reset secondary-action"
              disabled={saving}
              type="button"
              onClick={resetProfileForm}
            >
              Cancel
            </button>
          </div>
          </form>
          <form className="form-panel" onSubmit={handlePasswordSubmit}>
          <div className="form-section-header">
            <h2>Change Password</h2>
          </div>
          <label>
            <span>New Password *</span>
            <input
              autoComplete="new-password"
              disabled={savingPassword}
              minLength={8}
              onChange={(event) => setNewPassword(event.target.value)}
              required
              type="password"
              value={newPassword}
            />
            <span className="form-help">Use at least 8 characters.</span>
          </label>
          <label>
            <span>Confirm New Password *</span>
            <input
              autoComplete="new-password"
              disabled={savingPassword}
              minLength={8}
              onChange={(event) => setConfirmPassword(event.target.value)}
              required
              type="password"
              value={confirmPassword}
            />
          </label>
          {passwordError ? <p className="form-error">{passwordError}</p> : null}
          {passwordSuccessMessage ? (
            <p className="form-success">{passwordSuccessMessage}</p>
          ) : null}
          <button className="button-link button-reset" disabled={savingPassword} type="submit">
            {savingPassword ? 'Changing...' : 'Change Password'}
          </button>
          </form>
        </>
      )}
    </section>
  );
}

function getPasswordErrorMessage(error) {
  if (error.code === 'auth/weak-password') {
    return 'New password must be at least 8 characters.';
  }

  if (error.code === 'auth/requires-recent-login') {
    return 'Please sign out, sign back in, and try changing your password again.';
  }

  return error.message;
}

function getPermissionSummary(permissions) {
  const selectedPermissions = USER_PERMISSION_OPTIONS
    .filter((permission) => permissions[permission.key])
    .map((permission) => permission.label);

  return selectedPermissions.length ? selectedPermissions.join(', ') : 'No Admin Permissions';
}

export default ProfilePage;
