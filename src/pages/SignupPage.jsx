import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import PageHeader from '../components/PageHeader.jsx';
import { US_STATES } from '../data/usStates.js';
import { DEFAULT_USER_PERMISSIONS } from '../data/userRoles.js';
import { auth, db, firebaseConfigured } from '../lib/firebase.js';
import {
  DEFAULT_MEMBERSHIP_SETTINGS,
  subscribeToMembershipSettings
} from '../services/configurationService.js';
import {
  buildDisplayName,
  buildBillingAddress,
  formatPhoneNumber,
  toTitleCase
} from '../utils/profileFormat.js';

const MEMBERSHIP_TERMS_VERSION = '2026-07-16';

function SignupPage() {
  const [searchParams] = useSearchParams();
  const [billingCity, setBillingCity] = useState('');
  const [billingCountry, setBillingCountry] = useState('United States');
  const [billingPostalCode, setBillingPostalCode] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingStreet, setBillingStreet] = useState('');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [firstName, setFirstName] = useState('');
  const [formError, setFormError] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [membershipSettings, setMembershipSettings] = useState(DEFAULT_MEMBERSHIP_SETTINGS);
  const navigate = useNavigate();
  const displayedTermsVersion = membershipSettings.termsVersion || MEMBERSHIP_TERMS_VERSION;

  useEffect(() => {
    const unsubscribe = subscribeToMembershipSettings(
      setMembershipSettings,
      () => setMembershipSettings(DEFAULT_MEMBERSHIP_SETTINGS)
    );

    return unsubscribe;
  }, []);

  async function handleSubmit(event) {
    event.preventDefault();
    setFormError('');

    if (!firstName.trim() || !lastName.trim()) {
      setFormError('First name and last name are required.');
      return;
    }

    if (password.length < 8) {
      setFormError('Password must be at least 8 characters.');
      return;
    }

    if (!termsAccepted) {
      setFormError('You must read and agree to the terms and conditions before submitting your membership request.');
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
      const formattedFirstName = toTitleCase(firstName);
      const formattedLastName = toTitleCase(lastName);
      const displayName = buildDisplayName(formattedFirstName, formattedLastName);

      await updateProfile(user, { displayName });
      await setDoc(doc(db, 'users', user.uid), {
        billingAddress: buildBillingAddress({
          city: billingCity,
          country: billingCountry,
          postalCode: billingPostalCode,
          state: billingState,
          street: billingStreet
        }),
        createdDate: serverTimestamp(),
        email: email.trim(),
        firstName: formattedFirstName,
        lastName: formattedLastName,
        membershipMatchedBy: 'account',
        membershipMemberId: '',
        membershipReviewNote: '',
        membershipReviewedBy: '',
        membershipStatus: 'Pending',
        membershipUpdatedDate: serverTimestamp(),
        name: displayName,
        permissions: DEFAULT_USER_PERMISSIONS,
        phone: formatPhoneNumber(phone),
        profileTags: [],
        role: 'General User',
        status: 'Active',
        termsAccepted: true,
        termsAcceptedDate: serverTimestamp(),
        termsVersion: displayedTermsVersion,
        updatedDate: serverTimestamp(),
        userId: user.uid
      });

      navigate('/', { replace: true });
    } catch (error) {
      setFormError(getSignupErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section>
      <PageHeader
        eyebrow="Membership"
        title="Become A Member"
        description="Create your Guild member profile and login. New membership requests stay pending until an administrator records payment or activates the membership."
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
          <span>First Name *</span>
          <input
            autoComplete="given-name"
            disabled={!firebaseConfigured || submitting}
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
            disabled={!firebaseConfigured || submitting}
            onBlur={(event) => setLastName(toTitleCase(event.target.value))}
            onChange={(event) => setLastName(event.target.value)}
            required
            value={lastName}
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
              disabled={!firebaseConfigured || submitting}
              onBlur={(event) => setBillingStreet(toTitleCase(event.target.value))}
              onChange={(event) => setBillingStreet(event.target.value)}
              value={billingStreet}
            />
          </label>
          <label>
            <span>City</span>
            <input
              autoComplete="billing address-level2"
              disabled={!firebaseConfigured || submitting}
              onBlur={(event) => setBillingCity(toTitleCase(event.target.value))}
              onChange={(event) => setBillingCity(event.target.value)}
              value={billingCity}
            />
          </label>
          <label>
            <span>State</span>
            <select
              autoComplete="billing address-level1"
              disabled={!firebaseConfigured || submitting}
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
              disabled={!firebaseConfigured || submitting}
              onChange={(event) => setBillingPostalCode(event.target.value)}
              value={billingPostalCode}
            />
          </label>
          <label>
            <span>Country</span>
            <input
              autoComplete="billing country-name"
              disabled={!firebaseConfigured || submitting}
              onBlur={(event) => setBillingCountry(toTitleCase(event.target.value))}
              onChange={(event) => setBillingCountry(event.target.value)}
              value={billingCountry}
            />
          </label>
        </div>
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
        <div className="terms-panel">
          <h3>Terms And Conditions</h3>
          <p className="form-help">
            Terms version: {displayedTermsVersion}
          </p>
          {membershipSettings.termsText ? (
            <div className="terms-text">{membershipSettings.termsText}</div>
          ) : (
            <p className="form-help">
              Please review the Guild membership terms and conditions provided by the Guild before submitting this request.
            </p>
          )}
        </div>
        <label className="checkbox-label">
          <input
            checked={termsAccepted}
            disabled={!firebaseConfigured || submitting}
            required
            type="checkbox"
            onChange={(event) => setTermsAccepted(event.target.checked)}
          />
          <span className="checkbox-label-copy">
            <span>I have read and agree to the Guild terms and conditions.</span>
            <span className="form-help">
              Required before submitting a membership request.
            </span>
          </span>
        </label>
        {formError ? <p className="form-error">{formError}</p> : null}
        <button
          className="button-link button-reset"
          disabled={!firebaseConfigured || submitting || !termsAccepted}
          type="submit"
        >
          {submitting ? 'Submitting Membership Request...' : 'Become A Member'}
        </button>
      </form>
    </section>
  );
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
