import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import {
  signOut,
  updatePassword,
  updateProfile
} from 'firebase/auth';
import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { USER_PERMISSION_OPTIONS, normalizePermissions } from '../data/userRoles.js';
import { US_STATES } from '../data/usStates.js';
import { auth, db, firebaseConfigured } from '../lib/firebase.js';
import { applyMemberDirectorySync } from '../services/memberDirectoryProfile.js';
import { subscribeToMembershipPayments } from '../services/registrationService.js';
import { formatCurrency } from '../utils/eventFormat.js';
import {
  buildDisplayName,
  buildBillingAddress,
  formatBillingSummary,
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
  // The page opened straight into an always-editable form, which left Cancel
  // with nothing to return to: with no edits made it was a no-op that changed
  // nothing on screen, so it read as a dead button. Profile details are read by
  // default and edited deliberately, matching how the admin UserControlPanel
  // already works.
  const [isEditing, setIsEditing] = useState(false);
  const [membershipPayments, setMembershipPayments] = useState([]);
  const [searchParams] = useSearchParams();
  const showPasswordResetBanner = searchParams.get('passwordReset') === '1';
  // Arriving from a registration that was verified by emailed code. The
  // sign-in behind it is provisional: it exists only so a password can be set,
  // and the account still has none until one is saved here. Distinct from
  // passwordReset above, which comes from account recovery and is a real
  // session the member asked for.
  const passwordSetupMode = searchParams.get('passwordSetup') === '1';
  const passwordSetupSavedRef = useRef(false);
  const newPasswordInputRef = useRef(null);
  // Fires setIsEditing(true) at most once - without this guard, every
  // Firestore snapshot update to userProfile would re-run the effect below
  // and pop the form back into edit mode even after the member had
  // deliberately clicked Cancel.
  const autoEditOpenedRef = useRef(false);

  // Landed here straight from the login page's email/phone recovery flow -
  // draw attention to the password field they came here to fill in rather
  // than leaving them to notice the section on their own.
  useEffect(() => {
    if ((showPasswordResetBanner || passwordSetupMode) && currentUser) {
      newPasswordInputRef.current?.focus();
    }
  }, [showPasswordResetBanner, passwordSetupMode, currentUser]);

  // Leaving without saving one takes the provisional session with it.
  // Otherwise abandoning this page leaves someone signed in on an account that
  // has no password - which is what happened: a member backed out here, opened
  // another event, and was already signed in without having entered anything.
  useEffect(() => {
    if (!passwordSetupMode) {
      return undefined;
    }

    return () => {
      if (!passwordSetupSavedRef.current) {
        signOut(auth).catch(() => {});
      }
    };
  }, [passwordSetupMode]);

  // Also open the profile details straight into edit mode so they can fix
  // up their name/phone/address in the same visit, not just the password.
  // Waits for userProfile so the sync effect below has already populated
  // the form fields from real data before edit mode reveals them.
  useEffect(() => {
    if (showPasswordResetBanner && !passwordSetupMode && currentUser && userProfile && !autoEditOpenedRef.current) {
      autoEditOpenedRef.current = true;
      setIsEditing(true);
    }
  }, [showPasswordResetBanner, passwordSetupMode, currentUser, userProfile]);

  // Membership-type payments (dues), not event registration payments -
  // subscribeToMembershipPayments() queries entityId === the signed-in
  // member's own uid, matching the Firestore rule that gates this read.
  useEffect(() => {
    const uid = currentUser?.uid;

    if (!uid) {
      setMembershipPayments([]);
      return undefined;
    }

    const unsubscribe = subscribeToMembershipPayments(
      uid,
      (snapshot) => {
        setMembershipPayments(snapshot.docs.map((paymentDoc) => ({
          id: paymentDoc.id,
          ...paymentDoc.data()
        })));
      },
      () => setMembershipPayments([])
    );

    return unsubscribe;
  }, [currentUser?.uid]);

  // Field values only. Clearing the messages belongs to whoever is ending the
  // edit, not to a sync that fires whenever the auth context re-emits.
  const syncFormFromProfile = useCallback(() => {
    const billingAddress = userProfile?.billingAddress || {};

    setBillingCity(billingAddress.city || '');
    setBillingCountry(billingAddress.country || 'United States');
    setBillingPostalCode(billingAddress.postalCode || '');
    setBillingState(billingAddress.state || '');
    setBillingStreet(billingAddress.street || '');
    setFirstName(getProfileFirstName(userProfile) || getProfileFirstName({ name: currentUser?.displayName || '' }));
    setLastName(getProfileLastName(userProfile) || getProfileLastName({ name: currentUser?.displayName || '' }));
    setPhone(userProfile?.phone || '');
  }, [currentUser, userProfile]);

  // Only while not editing. `handleSubmit` calls Firebase Auth's updateProfile
  // before writing to Firestore, and that success re-emits `currentUser` with a
  // fresh identity - which re-created this callback and re-ran the sync
  // mid-save. It used to overwrite the fields being submitted with the stale
  // profile and wipe both the success and error messages, so a save that failed
  // reported nothing at all and a save that worked showed no confirmation.
  useEffect(() => {
    if (!isEditing) {
      syncFormFromProfile();
    }
  }, [isEditing, syncFormFromProfile]);

  function resetProfileForm() {
    syncFormFromProfile();
    setFormError('');
    setSuccessMessage('');
  }

  if (!firebaseConfigured) {
    return (
      <div className="empty-state">
        <h2>Profiles aren&apos;t available right now</h2>
        <p>Please try again later or contact support.</p>
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
      const profilePayload = {
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
      };
      await updateProfile(currentUser, { displayName });
      const batch = writeBatch(db);
      batch.update(doc(db, 'users', currentUser.uid), profilePayload);
      applyMemberDirectorySync(batch, currentUser.uid, {
        ...userProfile,
        ...profilePayload
      });
      await batch.commit();
      setSuccessMessage('Profile saved.');
      setIsEditing(false);
    } catch (error) {
      setFormError(getProfileSaveErrorMessage(error));
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
      // Before any state update, so the unmount cleanup above cannot race it
      // and sign out the session that now has a password behind it.
      passwordSetupSavedRef.current = true;
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccessMessage(
        passwordSetupMode
          ? 'Password set. You are signed in and can use this password from now on.'
          : 'Password changed.'
      );
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
          {!isEditing ? (
            <div className="detail-panel">
              <dl>
                <div>
                  <dt>Name</dt>
                  <dd>{buildDisplayName(firstName, lastName) || 'Not provided'}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{currentUser.email || userProfile?.email || 'Not provided'}</dd>
                </div>
                <div>
                  <dt>Phone</dt>
                  <dd>{phone || 'Not provided'}</dd>
                </div>
                <div>
                  <dt>Billing Address</dt>
                  <dd>{formatBillingSummary({
                    city: billingCity,
                    country: billingCountry,
                    postalCode: billingPostalCode,
                    state: billingState,
                    street: billingStreet
                  }) || 'Not provided'}</dd>
                </div>
                <div>
                  <dt>Role</dt>
                  <dd>{userProfile?.role || 'General User'}</dd>
                </div>
                <div>
                  <dt>Account Status</dt>
                  <dd>{getDisplayAccountStatus(userProfile)}</dd>
                </div>
                <div>
                  <dt>Membership Status</dt>
                  <dd>{getDisplayMembershipStatus(userProfile)}</dd>
                </div>
                <div>
                  <dt>Membership Payment</dt>
                  <dd>{formatMembershipPaymentSummary(userProfile)}</dd>
                </div>
                <div>
                  <dt>Membership Payment Updated</dt>
                  <dd>{formatDateTime(userProfile?.membershipPaymentUpdatedDate)}</dd>
                </div>
                <div>
                  <dt>Member Since</dt>
                  <dd>{formatDateTime(userProfile?.createdDate)}</dd>
                </div>
                <div>
                  {/*
                    Straight off the Firebase Auth user - nothing stores this on
                    the profile. Reads "This visit" on a first ever sign-in,
                    where Firebase records the current session as the last one.
                  */}
                  <dt>Last Sign-In</dt>
                  <dd>{formatSignInTime(currentUser?.metadata?.lastSignInTime)}</dd>
                </div>
                <div>
                  <dt>Profile Last Updated</dt>
                  <dd>{formatDateTime(userProfile?.updatedDate)}</dd>
                </div>
              </dl>
              <MembershipPaymentHistoryList payments={membershipPayments} />
              {successMessage ? <p className="form-success">{successMessage}</p> : null}
              <div className="form-actions">
                <button
                  className="button-link button-reset"
                  type="button"
                  onClick={() => {
                    setSuccessMessage('');
                    setIsEditing(true);
                  }}
                >
                  Edit Profile
                </button>
                <Link className="button-link button-reset secondary-action" to="/my-registrations">
                  My Registrations &amp; Payments
                </Link>
              </div>
            </div>
          ) : (
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
              onClick={() => {
                resetProfileForm();
                setIsEditing(false);
              }}
            >
              Cancel
            </button>
          </div>
          </form>
          )}
          <form className="form-panel" onSubmit={handlePasswordSubmit}>
          <div className="form-section-header">
            <h2>Change Password</h2>
          </div>
          {passwordSetupMode && !passwordSuccessMessage ? (
            <p className="form-help">
              Your registration is complete. Choose a password to finish setting
              up your account - until you save one, this account still has no
              password and you are not signed in.
            </p>
          ) : null}
          {showPasswordResetBanner && !passwordSetupMode ? (
            <p className="form-success">
              You&apos;re signed in. Set a new password below to finish
              recovering your account.
            </p>
          ) : null}
          <label>
            <span>New Password *</span>
            <input
              autoComplete="new-password"
              disabled={savingPassword}
              minLength={8}
              onChange={(event) => setNewPassword(event.target.value)}
              ref={newPasswordInputRef}
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
          <div className="form-actions">
            <button className="button-link button-reset" disabled={savingPassword} type="submit">
              {savingPassword
                ? 'Saving...'
                : passwordSetupMode ? 'Set Password' : 'Change Password'}
            </button>
            {passwordSetupMode && !passwordSuccessMessage ? (
              // Navigating away is what signs them out - the cleanup above
              // does it, so this only has to leave.
              <Link className="button-link button-reset secondary-action" to="/events">
                Skip For Now
              </Link>
            ) : null}
          </div>
          </form>
        </>
      )}
    </section>
  );
}

function getProfileSaveErrorMessage(error) {
  // Firestore raises this when the security rules reject the write, which the
  // member can do nothing about and "Missing or insufficient permissions."
  // does not explain. It points at a rules deployment, not at their input.
  if (error.code === 'permission-denied') {
    return 'Your profile could not be saved because this account is not permitted to change it. Please contact an administrator - nothing you entered was wrong.';
  }

  if (error.code === 'unavailable' || error.code === 'auth/network-request-failed') {
    return 'Could not connect. Check your internet connection and try again.';
  }

  return error.message || 'Your profile could not be saved. Please try again.';
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

function formatSignInTime(value) {
  if (!value) {
    return 'Not recorded';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? 'Not recorded' : date.toLocaleString();
}

function getPermissionSummary(permissions) {
  const selectedPermissions = USER_PERMISSION_OPTIONS
    .filter((permission) => permissions[permission.key])
    .map((permission) => permission.label);

  return selectedPermissions.length ? selectedPermissions.join(', ') : 'No Admin Permissions';
}

// Mirrors AdminRegisterMemberPanel.jsx's getDisplayAccountStatus(): Super User
// accounts aren't managed through the ordinary status field at all, so
// without this exception one bootstrapped outside the normal Add User flow
// (never explicitly set to 'Active') would read as not Active here.
function getDisplayAccountStatus(profile) {
  if (!profile) {
    return 'Unknown';
  }

  if (profile.role === 'Super User') {
    return 'Active';
  }

  if (profile.archivedBy || profile.archivedDate || profile.status === 'Archived') {
    return 'Archived';
  }

  return profile.status || 'Unknown';
}

// Mirrors UserControlPanel.jsx's getDisplayMembershipStatus(): Super Users
// aren't tracked as Guild members, so their membershipStatus field (if any)
// isn't meaningful here.
function getDisplayMembershipStatus(profile) {
  if (!profile) {
    return 'Unknown';
  }

  return profile.role === 'Super User' ? 'N/A' : profile.membershipStatus || 'Unknown';
}

function formatMembershipPaymentSummary(profile) {
  const status = profile?.membershipPaymentStatus || 'Pending';
  const amount = formatCurrency(profile?.membershipPaymentAmount || 0);
  const method = profile?.membershipPaymentMethod;

  return method ? `${status}, ${amount} (${method})` : `${status}, ${amount}`;
}

function formatDateTime(value) {
  if (!value) {
    return 'Not Set';
  }

  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not Set' : date.toLocaleString();
}

function getTimestampValue(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

// Mirrors UserControlPanel.jsx's MembershipPaymentHistory(), the admin
// equivalent of this same list.
function MembershipPaymentHistoryList({ payments }) {
  const sortedPayments = [...payments].sort(
    (first, second) => getTimestampValue(second.createdDate) - getTimestampValue(first.createdDate)
  );

  if (!sortedPayments.length) {
    return (
      <div className="payment-history-list membership-payment-history">
        <strong>Membership Payment History</strong>
        <p className="form-help">No membership payment history has been recorded yet.</p>
      </div>
    );
  }

  return (
    <div className="payment-history-list membership-payment-history">
      <strong>Membership Payment History</strong>
      {sortedPayments.map((payment) => (
        <div className="payment-history-item" key={payment.id}>
          <div>
            <strong>
              {payment.status || 'Pending'}
              {payment.method ? ` (${payment.method})` : ''}
            </strong>
            <span>{formatDateTime(payment.createdDate)}</span>
          </div>
          <div>
            <span>{formatCurrency(payment.amount || 0)}</span>
            <span>{payment.createdByName || payment.createdByEmail || 'Recorded by system'}</span>
          </div>
          {payment.note ? <p>{payment.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

export default ProfilePage;
