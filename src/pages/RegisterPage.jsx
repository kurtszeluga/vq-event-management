import { useEffect, useMemo, useRef, useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Link, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { US_STATES } from '../data/usStates.js';
import { getEvent } from '../services/eventService.js';
import {
  createRegistration,
  loadSquarePaymentConfig,
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
const squareScriptPromises = new Map();

function RegisterPage() {
  const [searchParams] = useSearchParams();
  const { currentUser, userProfile } = useAuth();
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
  const [paymentPreference, setPaymentPreference] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneVerificationError, setPhoneVerificationError] = useState('');
  const [phoneVerificationInput, setPhoneVerificationInput] = useState('');
  const [phoneVerificationSubmitting, setPhoneVerificationSubmitting] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [reactivateProfile, setReactivateProfile] = useState(false);
  const [reactivationTermsAccepted, setReactivationTermsAccepted] = useState(false);
  const [showPhoneVerification, setShowPhoneVerification] = useState(false);
  const [squareCard, setSquareCard] = useState(null);
  const [squareConfig, setSquareConfig] = useState(null);
  const [squareError, setSquareError] = useState('');
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
    setPaymentPreference('');
  }, [eventId]);

  useEffect(() => {
    const unsubscribe = subscribeToMembershipSettings(
      setMembershipSettings,
      () => setMembershipSettings(DEFAULT_MEMBERSHIP_SETTINGS)
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!eventId || !currentUser || !userProfile?.email || lookupComplete || lookupLoading) {
      return;
    }

    runEmailLookup(userProfile.email, { alreadyVerified: true });
  }, [currentUser, eventId, lookupComplete, lookupLoading, userProfile]);

  useEffect(() => {
    if (!isPaidEvent) {
      setSquareCard(null);
      setSquareConfig(null);
      setSquareError('');
      return;
    }

    let active = true;

    loadSquarePaymentConfig()
      .then((config) => {
        if (!active) {
          return;
        }

        setSquareConfig(config);
        setSquareError(config.enabled ? '' : 'Online card payment is not configured yet.');
      })
      .catch((error) => {
        if (active) {
          setSquareCard(null);
          setSquareConfig(null);
          setSquareError(error.message);
        }
      });

    return () => {
      active = false;
    };
  }, [isPaidEvent]);

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
  const isPaidEvent = Boolean(event?.isPaid) && Number(event?.cost || 0) > 0;
  const canPayLaterByCashCheck = isPaidEvent && Boolean(event?.allowCashCheckPayment);
  const requiresSquarePayment = isPaidEvent && paymentPreference !== 'cash-check-later';
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
  const usingSignedInProfile = Boolean(currentUser && userProfile?.email);
  const requiresReactivationTerms = Boolean(
    reactivateProfile
      && matchedProfile
      && matchedProfile.status !== 'Active'
      && !confirmation
  );

  async function handleEmailLookup() {
    await runEmailLookup(email);
  }

  async function runEmailLookup(emailValue, options = {}) {
    const normalizedEmail = String(emailValue || '').trim().toLowerCase();
    const alreadyVerified = Boolean(options.alreadyVerified);

    setFieldErrors({});
    setAccountVerified(alreadyVerified);
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

    setEmail(normalizedEmail);
    setLookupLoading(true);

    try {
      const result = await lookupRegistrationEmail(normalizedEmail, eventId);
      setLookup(result);
      setLookupComplete(true);

      if (result.profile) {
        applyProfileToForm(result.profile);
        setAccountVerified(alreadyVerified);
        setReactivateProfile(alreadyVerified && result.profile.status !== 'Active');
        setReactivationTermsAccepted(false);
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
      const squarePaymentToken = requiresSquarePayment
        ? await tokenizeSquarePayment()
        : '';
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
        paymentPreference: canPayLaterByCashCheck ? paymentPreference : '',
        phone,
        profileUserId: matchedProfile?.userId || '',
        profileUpdates,
        reactivateProfile,
        reactivationTermsAccepted,
        squarePaymentToken,
        termsVersion: displayedTermsVersion
      });
      setConfirmation(result);
    } catch (error) {
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function tokenizeSquarePayment() {
    if (!squareCard) {
      throw new Error(squareError || 'Card payment is not ready yet.');
    }

    const tokenResult = await squareCard.tokenize({
      amount: getEventPaymentTotal(event).toFixed(2),
      billingContact: {
        addressLines: [billingStreet].filter(Boolean),
        city: billingCity,
        countryCode: 'US',
        email,
        familyName: lastName,
        givenName: firstName,
        phone,
        postalCode: billingPostalCode,
        state: billingState
      },
      currencyCode: 'USD',
      customerInitiated: true,
      intent: 'CHARGE',
      sellerKeyedIn: false
    });

    if (tokenResult.status !== 'OK') {
      throw new Error(getSquareTokenizeError(tokenResult));
    }

    return tokenResult.token;
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
    window.close();

    window.setTimeout(() => {
      if (returnTarget) {
        window.location.assign(returnTarget);
        return;
      }

      setCloseMessage('You can close this registration window or tab.');
    }, 250);
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
            <span>{usingSignedInProfile ? 'Signed In Email' : 'Email *'}</span>
            <input
              className={fieldErrors.email ? 'field-invalid' : ''}
              disabled={usingSignedInProfile || submitting || Boolean(confirmation)}
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
            {usingSignedInProfile ? (
              <span className="form-help">
                We used your signed-in profile to start this registration.
              </span>
            ) : null}
          </label>
          {usingSignedInProfile ? (
            lookupLoading ? <p className="form-help">Checking your profile...</p> : null
          ) : (
            <button
              className="button-link button-reset"
              disabled={lookupLoading || submitting || Boolean(confirmation)}
              type="button"
              onClick={handleEmailLookup}
            >
              {lookupLoading ? 'Checking...' : 'Check Email'}
            </button>
          )}
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
                  {canPayLaterByCashCheck ? (
                    <label className="checkbox-label">
                      <input
                        checked={paymentPreference === 'cash-check-later'}
                        disabled={submitting || Boolean(confirmation)}
                        type="checkbox"
                        onChange={(inputEvent) =>
                          setPaymentPreference(inputEvent.target.checked ? 'cash-check-later' : '')
                        }
                      />
                      <span className="checkbox-label-copy">
                        <span>I will pay by cash or check later.</span>
                        <span className="form-help">
                          Your spot will be registered now, and payment will remain pending until received.
                        </span>
                      </span>
                    </label>
                  ) : null}
                  {isPaidEvent ? (
                    <RegistrationPaymentPanel
                      amountDue={getEventPaymentTotal(event)}
                      config={squareConfig}
                      disabled={submitting || Boolean(confirmation)}
                      error={squareError}
                      onCardReady={setSquareCard}
                      onlinePaymentRequired={requiresSquarePayment}
                    />
                  ) : null}
                  {submitting ? (
                    <p className="form-success">
                      Submitting registration and preparing confirmation...
                    </p>
                  ) : null}
                  <button
                    className="button-link button-reset"
                    disabled={submitting
                      || Boolean(registrationUnavailable)
                      || (requiresSquarePayment && (!squareCard || Boolean(squareError)))
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
  const cost = event.isPaid
    ? `${formatCurrency(getEventPaymentTotal(event))} total`
    : 'No Charge';
  const paymentBreakdown = event.isPaid
    ? `${formatCurrency(event.cost || 0)} + ${formatCurrency(event.serviceFee || 0)} service fee`
    : '';

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
          <dd>
            {cost}
            {paymentBreakdown ? <span className="form-help">{paymentBreakdown}</span> : null}
          </dd>
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
            : confirmation.status === 'Pending Payment'
              ? 'Registration pending payment.'
            : 'Registration confirmed.'}
        </strong>
        <span>
          {confirmation.profileReactivated ? ' Your profile was reactivated.' : ''}
          {confirmation.paymentStatus === 'Pending'
            ? confirmation.paymentPreference === 'cash-check-later'
              ? ' Your spot is registered. Payment is pending until cash or check is received.'
              : ' Payment is pending.'
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

function RegistrationPaymentPanel({
  amountDue,
  config,
  disabled,
  error,
  onCardReady,
  onlinePaymentRequired
}) {
  const cardContainerId = useRef(`square-card-${Math.random().toString(36).slice(2)}`);
  const [localError, setLocalError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!onlinePaymentRequired || !config?.enabled) {
      onCardReady(null);
      return undefined;
    }

    let cancelled = false;
    let cardInstance = null;

    async function initializeSquareCard() {
      setLoading(true);
      setLocalError('');

      try {
        await loadSquareScript(config.scriptUrl);

        if (!window.Square) {
          throw new Error('Square payment form could not be loaded.');
        }

        const payments = window.Square.payments(config.applicationId, config.locationId);
        cardInstance = await payments.card();
        await cardInstance.attach(`#${cardContainerId.current}`);

        if (!cancelled) {
          onCardReady(cardInstance);
        }
      } catch (squareLoadError) {
        if (!cancelled) {
          onCardReady(null);
          setLocalError(squareLoadError.message || 'Square payment form could not be loaded.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initializeSquareCard();

    return () => {
      cancelled = true;
      onCardReady(null);

      if (cardInstance && typeof cardInstance.destroy === 'function') {
        cardInstance.destroy();
      }
    };
  }, [config, onCardReady, onlinePaymentRequired]);

  return (
    <div className="registration-payment-panel">
      <strong>Payment</strong>
      <span className="form-help">
        Amount due by card: {formatCurrency(amountDue)}
      </span>
      <p className="form-help">
        Your card information is entered directly into Square&apos;s secure payment form.
        The Village Quilters Network does not store your card number or security code.
      </p>
      {!onlinePaymentRequired ? (
        <p className="form-help">Cash/check later is selected, so online card payment is not needed now.</p>
      ) : null}
      {onlinePaymentRequired ? (
        <>
          <div
            aria-label="Secure Square card payment form"
            className={`square-card-container${disabled ? ' is-disabled' : ''}`}
            id={cardContainerId.current}
          />
          {loading ? <p className="form-help">Loading secure payment form...</p> : null}
          {error || localError ? <p className="form-error">{error || localError}</p> : null}
        </>
      ) : null}
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

function loadSquareScript(scriptUrl) {
  if (!scriptUrl) {
    return Promise.reject(new Error('Square payment script is not configured.'));
  }

  if (window.Square) {
    return Promise.resolve();
  }

  if (!squareScriptPromises.has(scriptUrl)) {
    squareScriptPromises.set(scriptUrl, new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = scriptUrl;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Square payment script could not be loaded.'));
      document.head.appendChild(script);
    }));
  }

  return squareScriptPromises.get(scriptUrl);
}

function getEventPaymentTotal(event) {
  return Number(event?.cost || 0) + Number(event?.serviceFee || 0);
}

function getSquareTokenizeError(tokenResult) {
  const errors = tokenResult?.errors || [];
  const message = errors
    .map((squareError) => squareError.message)
    .filter(Boolean)
    .join(' ');

  return message || 'Card payment could not be verified. Please check the card details and try again.';
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
