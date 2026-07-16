import { useEffect, useMemo, useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { US_STATES } from '../data/usStates.js';
import { getEvent } from '../services/eventService.js';
import {
  createRegistration,
  lookupRegistrationEmail,
  verifyRegistrationPhone
} from '../services/registrationService.js';
import {
  DEFAULT_MEMBERSHIP_SETTINGS,
  subscribeToMembershipSettings
} from '../services/configurationService.js';
import { auth } from '../lib/firebase.js';
import {
  formatCurrency,
  formatEventDate,
  formatTimeRange,
  isEventVisible
} from '../utils/eventFormat.js';
import {
  buildBillingAddress,
  buildDisplayName,
  formatPhoneNumber,
  getProfileFirstName,
  getProfileLastName,
  toTitleCase
} from '../utils/profileFormat.js';

const MEMBERSHIP_TERMS_VERSION = '2026-07-16';

function RegisterPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const eventId = searchParams.get('eventId') || '';
  const returnUrl = getSafeReturnUrl(searchParams.get('returnUrl') || '');
  const referrerUrl = getExternalReferrerUrl();
  const returnTarget = returnUrl || referrerUrl;
  const [billingCity, setBillingCity] = useState('');
  const [billingCountry, setBillingCountry] = useState('United States');
  const [billingPostalCode, setBillingPostalCode] = useState('');
  const [billingState, setBillingState] = useState('');
  const [billingStreet, setBillingStreet] = useState('');
  const [accountVerified, setAccountVerified] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [closeMessage, setCloseMessage] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [email, setEmail] = useState('');
  const [event, setEvent] = useState(null);
  const [eventError, setEventError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [firstName, setFirstName] = useState('');
  const [formError, setFormError] = useState('');
  const [lastName, setLastName] = useState('');
  const [loadingEvent, setLoadingEvent] = useState(Boolean(eventId));
  const [lookup, setLookup] = useState(null);
  const [lookupComplete, setLookupComplete] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [membershipSettings, setMembershipSettings] = useState(DEFAULT_MEMBERSHIP_SETTINGS);
  const [needsProfileEdits, setNeedsProfileEdits] = useState(false);
  const [phone, setPhone] = useState('');
  const [phoneVerificationError, setPhoneVerificationError] = useState('');
  const [phoneVerificationInput, setPhoneVerificationInput] = useState('');
  const [phoneVerificationSubmitting, setPhoneVerificationSubmitting] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [reactivateProfile, setReactivateProfile] = useState(false);
  const [reactivationTermsAccepted, setReactivationTermsAccepted] = useState(false);
  const [showPhoneVerification, setShowPhoneVerification] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const displayedTermsVersion = membershipSettings.termsVersion || MEMBERSHIP_TERMS_VERSION;

  useEffect(() => {
    if (!eventId) {
      setLoadingEvent(false);
      setEvent(null);
      return undefined;
    }

    let active = true;

    async function loadEvent() {
      setLoadingEvent(true);
      try {
        const eventRecord = await getEvent(eventId);

        if (active) {
          setEvent(eventRecord);
          setEventError('');
        }
      } catch (error) {
        if (active) {
          setEventError(error.message);
        }
      } finally {
        if (active) {
          setLoadingEvent(false);
        }
      }
    }

    loadEvent();

    return () => {
      active = false;
    };
  }, [eventId]);

  useEffect(() => {
    const unsubscribe = subscribeToMembershipSettings(
      setMembershipSettings,
      () => setMembershipSettings(DEFAULT_MEMBERSHIP_SETTINGS)
    );

    return unsubscribe;
  }, []);

  const registrationUnavailable = useMemo(() => {
    if (!event) {
      return '';
    }

    if (!isEventVisible(event)) {
      return 'This event is not currently available.';
    }

    if (!event.registrationOpen) {
      return 'Registration is not currently open for this event.';
    }

    if (['Business Listing', 'For Sale'].includes(event.eventType)) {
      return 'This listing does not accept registrations.';
    }

    return '';
  }, [event]);

  const membershipBlocked = lookupComplete
    && ['already-registered', 'profile-membership-blocked', 'membership-blocked', 'membership-not-found'].includes(lookup?.status);
  const nonMemberRegistrationAllowed = lookup?.status === 'non-member-registration-allowed';
  const matchedProfile = lookup?.profile || null;
  const requiresBillingAddress = Boolean(event?.isPaid) && Number(event?.cost || 0) > 0;
  const showAddressFields = requiresBillingAddress || Boolean(matchedProfile);
  const needsAccountPassword = lookupComplete
    && Boolean(matchedProfile)
    && !membershipBlocked
    && !accountVerified
    && !phoneVerified;
  const needsPhoneVerification = lookupComplete
    && !membershipBlocked
    && (
      (!matchedProfile && !phoneVerified)
      || (Boolean(matchedProfile) && showPhoneVerification && !phoneVerified)
    );
  const canShowRegistrantFields = lookupComplete
    && !membershipBlocked
    && (accountVerified || phoneVerified || nonMemberRegistrationAllowed);
  const requiresReactivationTerms = Boolean(
    reactivateProfile
      && matchedProfile
      && matchedProfile.status !== 'Active'
      && !confirmation
  );

  async function handleEmailLookup() {
    const normalizedEmail = email.trim().toLowerCase();

    setFieldErrors({});
    setAccountVerified(false);
    setAuthError('');
    setAuthPassword('');
    setFormError('');
    setConfirmation(null);
    setLookup(null);
    setLookupComplete(false);
    setPhoneVerificationError('');
    setPhoneVerificationInput('');
    setPhoneVerified(false);
    setProfileConfirmed(false);
    setReactivateProfile(false);
    setReactivationTermsAccepted(false);
    setShowPhoneVerification(false);

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setFieldErrors({ email: 'Valid email is required.' });
      setFormError('Enter a valid email address first.');
      return;
    }

    setLookupLoading(true);

    try {
      const result = await lookupRegistrationEmail(normalizedEmail, eventId);
      setEmail(normalizedEmail);
      setLookup(result);
      setLookupComplete(true);

      if (result.profile) {
        applyProfileToForm(result.profile);
        setShowPhoneVerification(false);
      } else if (result.status === 'non-member-registration-allowed') {
        resetRegistrantFields();
        setPhoneVerificationInput('');
        setShowPhoneVerification(false);
      } else {
        resetRegistrantFields();
        setPhoneVerificationInput('');
        setShowPhoneVerification(result.status === 'new-registrant');
      }
    } catch (error) {
      setFormError(error.message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleSubmit(formEvent) {
    formEvent.preventDefault();
    const errors = validateForm({ email, firstName, lastName, phone });
    const displayName = buildDisplayName(firstName, lastName);

    setFieldErrors(errors);
    setFormError('');
    setConfirmation(null);

    if (!lookupComplete) {
      setFormError('Please look up the email address first.');
      return;
    }

    if (!accountVerified && !phoneVerified) {
      setFormError('Please verify your account information before registering.');
      return;
    }

    if (Object.keys(errors).length) {
      setFormError('Please fix the highlighted fields.');
      return;
    }

    if (registrationUnavailable) {
      setFormError(registrationUnavailable);
      return;
    }

    if (requiresReactivationTerms && !reactivationTermsAccepted) {
      setFormError('You must read and agree to the terms and conditions before reactivating your profile.');
      return;
    }

    setSubmitting(true);

    try {
      const profileUpdates = {
        firstName: toTitleCase(firstName),
        lastName: toTitleCase(lastName),
        phone: formatPhoneNumber(phone)
      };

      if (requiresBillingAddress) {
        profileUpdates.billingAddress = buildBillingAddress({
          city: billingCity,
          country: billingCountry,
          postalCode: billingPostalCode,
          state: billingState,
          street: billingStreet
        });
      }

      const result = await createRegistration({
        email,
        eventId,
        name: displayName,
        phone,
        profileUserId: matchedProfile?.userId || '',
        profileUpdates,
        reactivateProfile,
        reactivationTermsAccepted,
        termsVersion: displayedTermsVersion
      });
      setConfirmation(result);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function handlePasswordSignIn() {
    if (!matchedProfile) {
      return;
    }

    if (!authPassword) {
      setAuthError('Enter your password to continue.');
      return;
    }

    setAuthSubmitting(true);
    setAuthError('');
    setPhoneVerificationError('');

    try {
      await signInWithEmailAndPassword(auth, email, authPassword);
      setAccountVerified(true);
      setPhoneVerified(false);
      setShowPhoneVerification(false);
      setProfileConfirmed(matchedProfile.status === 'Active');
      setReactivateProfile(matchedProfile.status !== 'Active');
      setReactivationTermsAccepted(false);
    } catch {
      setAccountVerified(false);
      setAuthPassword('');
      setPhoneVerificationInput('');
      setPhoneVerificationError('We could not sign you in. You can continue by verifying your phone number.');
      setShowPhoneVerification(true);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handlePhoneVerification() {
    const normalizedPhone = formatPhoneNumber(phoneVerificationInput);

    setPhoneVerificationInput(normalizedPhone);
    setPhoneVerificationError('');

    if (normalizedPhone.replace(/\D/g, '').length < 10) {
      setFieldErrors((current) => ({ ...current, phone: 'Phone number is required.' }));
      setPhoneVerificationError('Enter the phone number tied to your membership record.');
      return;
    }

    setPhoneVerificationSubmitting(true);

    try {
      await verifyRegistrationPhone(email, normalizedPhone, eventId);
      setAccountVerified(false);
      setPhone(normalizedPhone);
      setPhoneVerified(true);
      setPhoneVerificationError('');
      setProfileConfirmed(Boolean(matchedProfile) && matchedProfile.status === 'Active');
      setReactivateProfile(Boolean(matchedProfile) && matchedProfile.status !== 'Active');
      setReactivationTermsAccepted(false);
    } catch (error) {
      setPhoneVerified(false);
      setPhoneVerificationError(error.message);
    } finally {
      setPhoneVerificationSubmitting(false);
    }
  }

  function handleClose() {
    if (returnTarget || window.opener) {
      window.close();

      window.setTimeout(() => {
        if (returnTarget) {
          window.location.assign(returnTarget);
          return;
        }

        navigate(`/events/${eventId}`);
      }, 250);
      return;
    }

    navigate(`/events/${eventId}`);
  }

  function handleCompletionClose() {
    window.close();
    window.setTimeout(() => {
      setCloseMessage('You can close this registration window or tab.');
    }, 250);
  }

  function handleStartProfileEdit() {
    setNeedsProfileEdits(true);
  }

  function handleCancelProfileEdit() {
    if (matchedProfile) {
      applyProfileToForm(matchedProfile);
    }
    setNeedsProfileEdits(false);
  }

  function handleSaveProfileEdit() {
    const errors = validateProfileFields({
      billingCity,
      billingCountry,
      billingPostalCode,
      billingState,
      billingStreet,
      firstName,
      lastName,
      phone
    });

    setFieldErrors(errors);

    if (Object.keys(errors).length) {
      setFormError('Please fix the highlighted profile fields before saving.');
      return;
    }

    setFormError('');
    setNeedsProfileEdits(false);
  }

  function applyProfileToForm(profile) {
    setFirstName(getProfileFirstName(profile));
    setLastName(getProfileLastName(profile));
    setPhone(profile.phone || '');
    setBillingCity(profile.billingAddress?.city || '');
    setBillingCountry(profile.billingAddress?.country || 'United States');
    setBillingPostalCode(profile.billingAddress?.postalCode || '');
    setBillingState(profile.billingAddress?.state || '');
    setBillingStreet(profile.billingAddress?.street || '');
  }

  function resetRegistrantFields() {
    setFirstName('');
    setLastName('');
    setPhone('');
    setBillingCity('');
    setBillingCountry('United States');
    setBillingPostalCode('');
    setBillingState('');
    setBillingStreet('');
  }

  if (!eventId) {
    return (
      <section>
        <PageHeader
          eyebrow="Registration"
          title="Select an Event"
          description="Choose an event before starting registration."
        />
        <Link className="button-link" to="/events">
          View Events
        </Link>
      </section>
    );
  }

  if (loadingEvent) {
    return (
      <section>
        <PageHeader
          eyebrow="Registration"
          title="Loading Registration"
          description="Preparing the event registration form."
        />
      </section>
    );
  }

  if (eventError || !event) {
    return (
      <section>
        <PageHeader
          eyebrow="Registration"
          title="Event Unavailable"
          description={eventError || 'This event could not be found.'}
        />
        <Link className="button-link" to="/events">
          Back To Events
        </Link>
      </section>
    );
  }

  if (confirmation) {
    return (
      <section>
        <PageHeader
          eyebrow="Registration"
          title="Registration Complete"
          description="Your registration has been received."
        />
        <div className="registration-layout">
          <EventSummary event={event} />
          <RegistrationCompletion
            closeMessage={closeMessage}
            confirmation={confirmation}
            event={event}
            onReturn={handleCompletionClose}
          />
        </div>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow="Registration"
        title={`Register For ${event.title}`}
        description="Start with your email address so we can check your profile and membership."
      />
      <div className="registration-layout">
        <EventSummary event={event} />
        <form className="form-panel registration-form" onSubmit={handleSubmit}>
          {registrationUnavailable ? (
            <p className="form-error">{registrationUnavailable}</p>
          ) : null}
          {formError ? <p className="form-error">{formError}</p> : null}
          <label>
            <span>Email *</span>
            <input
              className={fieldErrors.email ? 'field-invalid' : ''}
              disabled={submitting || Boolean(confirmation)}
              onChange={(inputEvent) => {
                setEmail(inputEvent.target.value);
                setLookupComplete(false);
                setLookup(null);
                setProfileConfirmed(false);
                setReactivateProfile(false);
                setAccountVerified(false);
                setAuthError('');
                setAuthPassword('');
                setPhoneVerificationError('');
                setPhoneVerificationInput('');
                setPhoneVerified(false);
                setShowPhoneVerification(false);
                setNeedsProfileEdits(false);
                setReactivationTermsAccepted(false);
                resetRegistrantFields();
              }}
              type="email"
              value={email}
            />
          </label>
          <button
            className="button-link button-reset"
            disabled={lookupLoading || submitting || Boolean(confirmation)}
            type="button"
            onClick={handleEmailLookup}
          >
            {lookupLoading ? 'Checking...' : 'Check Email'}
          </button>
          {lookupComplete ? (
            <LookupResult
              billingAddress={{
                city: billingCity,
                country: billingCountry,
                postalCode: billingPostalCode,
                state: billingState,
                street: billingStreet
              }}
              lookup={lookup}
              needsProfileEdits={needsProfileEdits}
              onEditProfile={handleStartProfileEdit}
              verificationPassed={accountVerified || phoneVerified}
            />
          ) : null}
          {needsAccountPassword ? (
            <div className="registration-lookup-card">
              <strong>Account Found</strong>
              <span>Enter your password to sign in and continue with registration.</span>
              {authError ? <p className="form-error">{authError}</p> : null}
              <label>
                <span>Password *</span>
                <input
                  autoComplete="current-password"
                  disabled={authSubmitting || Boolean(confirmation)}
                  onChange={(inputEvent) => {
                    setAuthPassword(inputEvent.target.value);
                    setAuthError('');
                  }}
                  type="password"
                  value={authPassword}
                />
              </label>
              <button
                className="button-link button-reset"
                disabled={authSubmitting || Boolean(confirmation)}
                type="button"
                onClick={handlePasswordSignIn}
              >
                {authSubmitting ? 'Signing in...' : 'Sign In And Continue'}
              </button>
            </div>
          ) : null}
          {needsPhoneVerification ? (
            <div className="registration-lookup-card">
              <strong>{matchedProfile ? 'Verify With Phone Number' : 'Membership Verification'}</strong>
              <span>
                Enter the phone number tied to this membership record so we can continue.
              </span>
              {phoneVerificationError ? <p className="form-error">{phoneVerificationError}</p> : null}
              <label>
                <span>Phone Number *</span>
                <input
                  className={fieldErrors.phone ? 'field-invalid' : ''}
                  autoComplete="off"
                  disabled={phoneVerificationSubmitting || Boolean(confirmation)}
                  name="registration-verification-phone"
                  onChange={(inputEvent) => {
                    setPhoneVerificationInput(formatPhoneNumber(inputEvent.target.value));
                    setPhoneVerificationError('');
                  }}
                  type="tel"
                  value={phoneVerificationInput}
                />
              </label>
              <button
                className="button-link button-reset"
                disabled={phoneVerificationSubmitting || Boolean(confirmation)}
                type="button"
                onClick={handlePhoneVerification}
              >
                {phoneVerificationSubmitting ? 'Verifying...' : 'Verify Phone And Continue'}
              </button>
            </div>
          ) : null}
          {canShowRegistrantFields ? (
            <>
              {(!matchedProfile || needsProfileEdits) ? (
                <div className="registration-profile-edit-grid">
                  <label>
                    <span>Email</span>
                    <input
                      disabled
                      readOnly
                      value={email}
                    />
                  </label>
                  <label>
                    <span>First Name *</span>
                    <input
                      className={fieldErrors.firstName ? 'field-invalid' : ''}
                      disabled={submitting || Boolean(confirmation)}
                      onBlur={(inputEvent) => setFirstName(toTitleCase(inputEvent.target.value))}
                      onChange={(inputEvent) => setFirstName(inputEvent.target.value)}
                      value={firstName}
                    />
                  </label>
                  <label>
                    <span>Last Name *</span>
                    <input
                      className={fieldErrors.lastName ? 'field-invalid' : ''}
                      disabled={submitting || Boolean(confirmation)}
                      onBlur={(inputEvent) => setLastName(toTitleCase(inputEvent.target.value))}
                      onChange={(inputEvent) => setLastName(inputEvent.target.value)}
                      value={lastName}
                    />
                  </label>
                  <label>
                    <span>Phone *</span>
                    <input
                      className={fieldErrors.phone ? 'field-invalid' : ''}
                      disabled={submitting || Boolean(confirmation)}
                      onChange={(inputEvent) => setPhone(formatPhoneNumber(inputEvent.target.value))}
                      type="tel"
                      value={phone}
                    />
                  </label>
                  {showAddressFields ? (
                    <>
                      <label>
                        <span>Street Address</span>
                        <input
                          disabled={submitting || Boolean(confirmation)}
                          onBlur={(inputEvent) => setBillingStreet(toTitleCase(inputEvent.target.value))}
                          onChange={(inputEvent) => setBillingStreet(inputEvent.target.value)}
                          value={billingStreet}
                        />
                      </label>
                      <label>
                        <span>City</span>
                        <input
                          disabled={submitting || Boolean(confirmation)}
                          onBlur={(inputEvent) => setBillingCity(toTitleCase(inputEvent.target.value))}
                          onChange={(inputEvent) => setBillingCity(inputEvent.target.value)}
                          value={billingCity}
                        />
                      </label>
                      <label>
                        <span>State</span>
                        <select
                          className={fieldErrors.billingState ? 'field-invalid' : ''}
                          disabled={submitting || Boolean(confirmation)}
                          onChange={(inputEvent) => setBillingState(inputEvent.target.value)}
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
                          className={fieldErrors.billingPostalCode ? 'field-invalid' : ''}
                          disabled={submitting || Boolean(confirmation)}
                          onChange={(inputEvent) => setBillingPostalCode(inputEvent.target.value)}
                          value={billingPostalCode}
                        />
                      </label>
                      <label>
                        <span>Country</span>
                        <input
                          disabled={submitting || Boolean(confirmation)}
                          onBlur={(inputEvent) => setBillingCountry(toTitleCase(inputEvent.target.value))}
                          onChange={(inputEvent) => setBillingCountry(inputEvent.target.value)}
                          value={billingCountry}
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              ) : null}
              {needsProfileEdits ? (
                <div className="detail-actions">
                  <button
                    className="button-link button-reset"
                    type="button"
                    onClick={handleSaveProfileEdit}
                  >
                    Save Changes
                  </button>
                  <button
                    className="button-link secondary-action"
                    type="button"
                    onClick={handleCancelProfileEdit}
                  >
                    Cancel Changes
                  </button>
                </div>
              ) : null}
              {requiresReactivationTerms ? (
                <>
                  <div className="terms-panel">
                    <h3>Terms And Conditions</h3>
                    <p className="form-help">
                      Terms version: {displayedTermsVersion}
                    </p>
                    {membershipSettings.termsText ? (
                      <div className="terms-text">{membershipSettings.termsText}</div>
                    ) : (
                      <p className="form-help">
                        Please review the Guild membership terms and conditions provided by the Guild before reactivating your profile.
                      </p>
                    )}
                  </div>
                  <label className="checkbox-label">
                    <input
                      checked={reactivationTermsAccepted}
                      disabled={submitting || Boolean(confirmation)}
                      required
                      type="checkbox"
                      onChange={(inputEvent) => setReactivationTermsAccepted(inputEvent.target.checked)}
                    />
                    <span className="checkbox-label-copy">
                      <span>I have read and agree to the Guild terms and conditions.</span>
                      <span className="form-help">
                        Required before reactivating this profile.
                      </span>
                    </span>
                  </label>
                </>
              ) : null}
              {!needsProfileEdits ? (
                <div className="registration-submit-block">
                  {submitting ? (
                    <p className="form-success">
                      Submitting registration and preparing confirmation...
                    </p>
                  ) : null}
                  <button
                    className="button-link button-reset"
                    disabled={submitting
                      || Boolean(registrationUnavailable)
                      || (requiresReactivationTerms && !reactivationTermsAccepted)}
                    type="submit"
                  >
                    {submitting ? 'Submitting...' : 'Submit Registration'}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
          <button className="button-link secondary-action" type="button" onClick={handleClose}>
            Cancel
          </button>
        </form>
      </div>
    </section>
  );
}

function getSafeReturnUrl(value) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function getExternalReferrerUrl() {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return '';
  }

  const referrer = getSafeReturnUrl(document.referrer || '');

  if (!referrer) {
    return '';
  }

  try {
    return new URL(referrer).origin === window.location.origin ? '' : referrer;
  } catch {
    return '';
  }
}

function LookupResult({
  billingAddress,
  lookup,
  needsProfileEdits,
  onEditProfile,
  verificationPassed,
}) {
  const profile = lookup?.profile;

  if (!lookup) {
    return null;
  }

  if (lookup.status === 'membership-not-found') {
    return (
      <div className="form-error">
        We could not find a Guild membership record for this email address. Guild membership is required to register. Please contact an administrator for assistance.
      </div>
    );
  }

  if (lookup.status === 'already-registered') {
    return (
      <div className="form-error">
        An active registration already exists for this email and event.
      </div>
    );
  }

  if (['profile-membership-blocked', 'membership-blocked'].includes(lookup.status)) {
    return (
      <div className="form-error">
        Your membership status is not currently active. Please contact an administrator for assistance.
      </div>
    );
  }

  if (lookup.status === 'non-member-registration-allowed') {
    return (
      <div className="registration-lookup-card">
        <strong>Non-Member Registration Allowed</strong>
        <span>This event allows non-members to register. Continue entering your information.</span>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="registration-lookup-card">
        <strong>No Profile Found</strong>
        <span>Membership confirmed. Continue entering your information.</span>
      </div>
    );
  }

  return (
    <div className="registration-lookup-card">
      <strong>Profile Found</strong>
      <dl>
        <div>
          <dt>Name</dt>
          <dd>{profile.name || 'Not listed'}</dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>{profile.email}</dd>
        </div>
        <div>
          <dt>Phone</dt>
          <dd>{profile.phone || 'Not listed'}</dd>
        </div>
        <div>
          <dt>Profile Status</dt>
          <dd>{profile.status}</dd>
        </div>
        <div>
          <dt>Membership</dt>
          <dd>{profile.membershipStatus}</dd>
        </div>
        <div>
          <dt>Address</dt>
          <dd>{formatAddress(billingAddress)}</dd>
        </div>
      </dl>
      {verificationPassed && !needsProfileEdits ? (
        <div className="registration-edit-prompt">
          <strong>Need to update your profile details first?</strong>
          <button
            className="button-link secondary-action"
            type="button"
            onClick={onEditProfile}
          >
            Yes, Update My Information
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EventSummary({ event }) {
  const cost = event.isPaid ? formatCurrency(event.cost) : 'Free';

  return (
    <aside className="registration-summary">
      <h2>{event.title}</h2>
      <dl>
        <div>
          <dt>Type</dt>
          <dd>{event.eventType}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatEventDate(event.date)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
        </div>
        <div>
          <dt>Location</dt>
          <dd>{event.location || 'To be announced'}</dd>
        </div>
        <div>
          <dt>Cost</dt>
          <dd>{cost}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{event.capacityUnlimited ? 'Unlimited' : event.capacity || 'To be announced'}</dd>
        </div>
      </dl>
    </aside>
  );
}

function RegistrationCompletion({ closeMessage, confirmation, event, onReturn }) {
  return (
    <div className="form-panel registration-completion-card">
      <div className="form-success">
        <strong>
          {confirmation.status === 'Waitlisted'
            ? 'You have been added to the waitlist.'
            : 'Registration confirmed.'}
        </strong>
        <span>
          {confirmation.profileReactivated ? ' Your profile was reactivated.' : ''}
          {confirmation.paymentRequired
            ? ' Payment is pending and will be handled when the payment module is enabled.'
            : ` You are registered for ${event.title}.`}
        </span>
      </div>
      <dl>
        <div>
          <dt>Event</dt>
          <dd>{event.title}</dd>
        </div>
        <div>
          <dt>Date</dt>
          <dd>{formatEventDate(event.date)}</dd>
        </div>
        <div>
          <dt>Time</dt>
          <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
        </div>
        <div>
          <dt>Registration Status</dt>
          <dd>{confirmation.status}</dd>
        </div>
        <div>
          <dt>Payment Status</dt>
          <dd>{confirmation.paymentStatus}</dd>
        </div>
      </dl>
      <div className="form-actions">
        <button className="button-link button-reset" type="button" onClick={onReturn}>
          Close Window
        </button>
      </div>
      {closeMessage ? <p className="form-help">{closeMessage}</p> : null}
    </div>
  );
}

function formatAddress(address = {}) {
  return [
    address.street,
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(' '),
    address.country
  ].filter(Boolean).join(', ') || 'Not listed';
}

function validateForm({ email, firstName, lastName, phone }) {
  const errors = {};

  if (!firstName.trim()) {
    errors.firstName = 'First name is required.';
  }

  if (!lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }

  if (!email.trim() || !email.includes('@')) {
    errors.email = 'Valid email is required.';
  }

  if (phone.replace(/\D/g, '').length < 10) {
    errors.phone = 'Phone number is required.';
  }

  return errors;
}

function validateProfileFields({
  billingCity,
  billingCountry,
  billingPostalCode,
  billingState,
  billingStreet,
  firstName,
  lastName,
  phone
}) {
  const errors = {};

  if (!firstName.trim()) {
    errors.firstName = 'First name is required.';
  }

  if (!lastName.trim()) {
    errors.lastName = 'Last name is required.';
  }

  if (phone.replace(/\D/g, '').length < 10) {
    errors.phone = 'Phone number is required.';
  }

  if (billingState && billingState.length !== 2) {
    errors.billingState = 'Use the two-letter state code.';
  }

  if (billingPostalCode && billingPostalCode.trim().length < 5) {
    errors.billingPostalCode = 'ZIP code should be at least 5 characters.';
  }

  return errors;
}

export default RegisterPage;
