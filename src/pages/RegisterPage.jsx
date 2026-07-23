import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { US_STATES } from '../data/usStates.js';
import { getEvent } from '../services/eventService.js';
import {
  beginSquareReservation,
  createRegistration,
  loadSquarePaymentConfig,
  lookupRegistrationEmail,
  startRegistrationEmailVerification,
  verifyRegistrationEmailCode
} from '../services/registrationService.js';
import {
  DEFAULT_MEMBERSHIP_SETTINGS,
  subscribeToMembershipSettings
} from '../services/configurationService.js';
import { auth } from '../lib/firebase.js';
import {
  formatCurrency,
  formatEventDate,
  formatRegistrationDateRange,
  formatTimeRange,
  getRegistrationEndDate,
  getRegistrationStartDate,
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
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { eventId: routeEventId = '' } = useParams();
  const { currentUser, userProfile } = useAuth();
  const eventId = searchParams.get('eventId') || routeEventId || '';
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
  const [emailVerificationChallengeId, setEmailVerificationChallengeId] = useState('');
  const [emailVerificationCode, setEmailVerificationCode] = useState('');
  const [emailVerificationError, setEmailVerificationError] = useState('');
  const [emailVerificationMessage, setEmailVerificationMessage] = useState('');
  const [emailVerificationSending, setEmailVerificationSending] = useState(false);
  const [emailVerificationVerifying, setEmailVerificationVerifying] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
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
  const [reactivateProfile, setReactivateProfile] = useState(false);
  const [reactivationTermsAccepted, setReactivationTermsAccepted] = useState(false);
  const [registrationVerificationToken, setRegistrationVerificationToken] = useState('');
  const [registrationFinalizing, setRegistrationFinalizing] = useState(false);
  const [showEmailVerification, setShowEmailVerification] = useState(false);
  const [squareCard, setSquareCard] = useState(null);
  const [squareConfig, setSquareConfig] = useState(null);
  const [squareError, setSquareError] = useState('');
  const [squareWalletToken, setSquareWalletToken] = useState('');
  const [paymentReservation, setPaymentReservation] = useState(null);
  const [paymentReservationError, setPaymentReservationError] = useState('');
  const [paymentReservationLoading, setPaymentReservationLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const paymentReservationRequestActive = useRef(false);

  const displayedTermsVersion = membershipSettings.termsVersion || MEMBERSHIP_TERMS_VERSION;
  const applyProfileToForm = useCallback((profile) => {
    setFirstName(getProfileFirstName(profile));
    setLastName(getProfileLastName(profile));
    setPhone(profile.phone || '');
    setBillingCity(profile.billingAddress?.city || '');
    setBillingCountry(profile.billingAddress?.country || 'United States');
    setBillingPostalCode(profile.billingAddress?.postalCode || '');
    setBillingState(profile.billingAddress?.state || '');
    setBillingStreet(profile.billingAddress?.street || '');
  }, []);
  const resetRegistrantFields = useCallback(() => {
    setFirstName('');
    setLastName('');
    setPhone('');
    setBillingCity('');
    setBillingCountry('United States');
    setBillingPostalCode('');
    setBillingState('');
    setBillingStreet('');
  }, []);
  const runEmailLookup = useCallback(async (emailValue, options = {}) => {
    const normalizedEmail = String(emailValue || '').trim().toLowerCase();
    const alreadyVerified = Boolean(options.alreadyVerified);

    setFieldErrors({});
    setAccountVerified(alreadyVerified);
    setAuthError('');
    setAuthPassword('');
    setFormError('');
    setConfirmation(null);
    setEmailVerificationChallengeId('');
    setEmailVerificationCode('');
    setEmailVerificationError('');
    setEmailVerificationMessage('');
    setEmailVerified(false);
    setRegistrationVerificationToken('');
    setPaymentReservation(null);
    setPaymentReservationError('');
    setPaymentReservationLoading(false);
    setLookup(null);
    setLookupComplete(false);
    setReactivateProfile(false);
    setReactivationTermsAccepted(false);
    setShowEmailVerification(false);

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
        setAccountVerified(Boolean(alreadyVerified && result.verified));
        setReactivateProfile(Boolean(alreadyVerified && result.profile.status !== 'Active'));
        setReactivationTermsAccepted(false);
        setShowEmailVerification(false);
      } else if (result.status === 'email-verification-required') {
        resetRegistrantFields();
        setShowEmailVerification(true);
      } else {
        resetRegistrantFields();
        setShowEmailVerification(false);
      }
    } catch (error) {
      setFormError(error.message);
    } finally {
      setLookupLoading(false);
    }
  }, [applyProfileToForm, eventId, resetRegistrantFields]);

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
    setPaymentReservation(null);
    setPaymentReservationError('');
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
  }, [currentUser, eventId, lookupComplete, lookupLoading, runEmailLookup, userProfile]);

  const membershipBlocked = lookupComplete
    && ['already-registered', 'profile-membership-blocked', 'membership-blocked', 'membership-not-found'].includes(lookup?.status);
  const matchedProfile = lookup?.profile || null;
  const profileExists = Boolean(lookup?.profileExists);
  const requiresBillingAddress = Boolean(event?.isPaid) && Number(event?.cost || 0) > 0;
  const isPaidEvent = Boolean(event?.isPaid) && Number(event?.cost || 0) > 0;
  const canPayLaterByCashCheck = isPaidEvent && Boolean(event?.allowCashCheckPayment);
  const requiresSquarePayment = isPaidEvent && paymentPreference !== 'cash-check-later';
  const showAddressFields = requiresBillingAddress || Boolean(matchedProfile);

  useEffect(() => {
    if (!isPaidEvent) {
      setSquareCard(null);
      setSquareConfig(null);
      setSquareError('');
      setSquareWalletToken('');
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

  useEffect(() => {
    setSquareWalletToken('');
    setPaymentReservation(null);
    setPaymentReservationError('');
  }, [
    billingCity,
    billingCountry,
    billingPostalCode,
    billingState,
    billingStreet,
    email,
    eventId,
    firstName,
    lastName,
    paymentPreference,
    phone
  ]);

  const buildRegistrationRequest = useCallback(() => {
    const displayName = buildDisplayName(firstName, lastName);
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

    return {
      email,
      eventId,
      name: displayName,
      paymentPreference: canPayLaterByCashCheck ? paymentPreference : '',
      phone,
      profileUserId: matchedProfile?.userId || '',
      profileUpdates,
      reactivateProfile,
      reactivationTermsAccepted,
      termsVersion: displayedTermsVersion,
      verificationChallengeId: emailVerificationChallengeId,
      verificationToken: registrationVerificationToken
    };
  }, [
    billingCity,
    billingCountry,
    billingPostalCode,
    billingState,
    billingStreet,
    canPayLaterByCashCheck,
    displayedTermsVersion,
    email,
    emailVerificationChallengeId,
    eventId,
    firstName,
    lastName,
    matchedProfile,
    paymentPreference,
    phone,
    reactivateProfile,
    reactivationTermsAccepted,
    registrationVerificationToken,
    requiresBillingAddress
  ]);

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

  const needsAccountPassword = lookupComplete
    && profileExists
    && !membershipBlocked
    && !accountVerified
    && !emailVerified
    && !showEmailVerification;
  const needsEmailVerification = lookupComplete
    && !membershipBlocked
    && Boolean(lookup?.verificationRequired)
    && (!profileExists || showEmailVerification)
    && !emailVerified;
  const canShowRegistrantFields = lookupComplete
    && !membershipBlocked
    && (accountVerified || emailVerified);
  const usingSignedInProfile = Boolean(currentUser && userProfile?.email);
  const requiresReactivationTerms = Boolean(
    reactivateProfile
      && matchedProfile
      && matchedProfile.status !== 'Active'
      && !confirmation
  );

  useEffect(() => {
    if (
      !requiresSquarePayment
      || !canShowRegistrantFields
      || needsProfileEdits
      || confirmation
      || paymentReservation
      || paymentReservationRequestActive.current
      || !email
      || (!accountVerified && !emailVerified)
    ) {
      return undefined;
    }

    let active = true;

    paymentReservationRequestActive.current = true;
    setPaymentReservationLoading(true);
    setPaymentReservationError('');

    beginSquareReservation(buildRegistrationRequest())
      .then((reservation) => {
        if (!active) {
          return;
        }

        setPaymentReservation(reservation);
        setPaymentReservationError('');
      })
      .catch((error) => {
        if (active) {
          setPaymentReservation(null);
          setPaymentReservationError(error.message);
        }
      })
      .finally(() => {
        if (active) {
          setPaymentReservationLoading(false);
        }
        paymentReservationRequestActive.current = false;
      });

    return () => {
      active = false;
    };
  }, [
    accountVerified,
    buildRegistrationRequest,
    canShowRegistrantFields,
    confirmation,
    email,
    emailVerified,
    needsProfileEdits,
    paymentReservation,
    requiresSquarePayment
  ]);

  async function handleEmailLookup() {
    await runEmailLookup(email);
  }

  async function handleSubmit(formEvent) {
    formEvent.preventDefault();
    const errors = validateForm({ email, firstName, lastName, phone });

    setFieldErrors(errors);
    setFormError('');
    setConfirmation(null);
    setRegistrationFinalizing(false);

    if (!lookupComplete) {
      setFormError('Please look up the email address first.');
      return;
    }

    if (!accountVerified && !emailVerified) {
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
      const registrationRequest = buildRegistrationRequest();
      const activePaymentReservation = requiresSquarePayment
        ? isPaymentReservationActive(paymentReservation)
          ? paymentReservation
          : await beginSquareReservation(registrationRequest)
        : null;
      const squarePaymentToken = requiresSquarePayment && activePaymentReservation?.paymentRequired !== false
        ? squareWalletToken || await tokenizeSquarePayment()
        : '';

      const result = await createRegistration({
        ...registrationRequest,
        paymentReservationId: activePaymentReservation?.reservationId || '',
        paymentReservationToken: activePaymentReservation?.reservationToken || '',
        squarePaymentToken,
      });
      setRegistrationFinalizing(true);
      setConfirmation(result);
    } catch (error) {
      setRegistrationFinalizing(false);
      setFormError(error.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function tokenizeSquarePayment() {
    if (squareWalletToken) {
      return squareWalletToken;
    }

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
    if (!profileExists) {
      return;
    }

    if (!authPassword) {
      setAuthError('Enter your password to continue.');
      return;
    }

    setAuthSubmitting(true);
    setAuthError('');
    setEmailVerificationError('');

    try {
      await signInWithEmailAndPassword(auth, email, authPassword);
      await runEmailLookup(email, { alreadyVerified: true });
    } catch {
      setAccountVerified(false);
      setAuthPassword('');
      setEmailVerificationCode('');
      setEmailVerificationError('We could not sign you in. You can continue with a code sent to your email address.');
      setShowEmailVerification(true);
    } finally {
      setAuthSubmitting(false);
    }
  }

  async function handleStartEmailVerification() {
    setEmailVerificationSending(true);
    setEmailVerificationError('');
    setEmailVerificationMessage('');

    try {
      const result = await startRegistrationEmailVerification(email, eventId);
      setEmailVerificationChallengeId(result.challengeId || '');
      setEmailVerificationCode('');
      setEmailVerificationMessage(result.message || 'Check your email for a verification code.');
      setShowEmailVerification(true);
    } catch (error) {
      setEmailVerificationError(error.message);
    } finally {
      setEmailVerificationSending(false);
    }
  }

  async function handleVerifyEmailCode() {
    const code = emailVerificationCode.replace(/\D/g, '').slice(0, 6);

    setEmailVerificationCode(code);
    setEmailVerificationError('');

    if (!emailVerificationChallengeId || code.length !== 6) {
      setEmailVerificationError('Enter the six-digit verification code from your email.');
      return;
    }

    setEmailVerificationVerifying(true);

    try {
      const result = await verifyRegistrationEmailCode({
        challengeId: emailVerificationChallengeId,
        code,
        email,
        eventId
      });

      setLookup(result);
      setLookupComplete(true);
      setAccountVerified(false);
      setEmailVerified(true);
      setRegistrationVerificationToken(result.registrationToken || '');
      setEmailVerificationError('');
      setEmailVerificationMessage('Email verified. You can continue with registration.');
      setShowEmailVerification(false);

      if (result.profile) {
        applyProfileToForm(result.profile);
        setReactivateProfile(result.profile.status !== 'Active');
      } else {
        resetRegistrantFields();
        setReactivateProfile(false);
      }

      setReactivationTermsAccepted(false);
    } catch (error) {
      setEmailVerified(false);
      setRegistrationVerificationToken('');
      setEmailVerificationError(error.message);
    } finally {
      setEmailVerificationVerifying(false);
    }
  }

  function handleClose() {
    window.close();

    window.setTimeout(() => {
      if (returnTarget) {
        window.location.assign(returnTarget);
        return;
      }

      if (window.history.length > 1) {
        navigate(-1);
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
                setReactivateProfile(false);
                setAccountVerified(false);
                setAuthError('');
                setAuthPassword('');
                setEmailVerificationChallengeId('');
                setEmailVerificationCode('');
                setEmailVerificationError('');
                setEmailVerificationMessage('');
                setEmailVerified(false);
                setRegistrationVerificationToken('');
                setShowEmailVerification(false);
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
              verificationPassed={accountVerified || emailVerified}
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
              <button
                className="button-link button-reset secondary-action"
                disabled={emailVerificationSending || authSubmitting || Boolean(confirmation)}
                type="button"
                onClick={handleStartEmailVerification}
              >
                {emailVerificationSending ? 'Sending Code...' : 'Email Me A Verification Code'}
              </button>
            </div>
          ) : null}
          {needsEmailVerification ? (
            <div className="registration-lookup-card">
              <strong>Email Verification</strong>
              <span>
                We will send a six-digit code to this email address so you can continue securely.
              </span>
              {emailVerificationError ? <p className="form-error">{emailVerificationError}</p> : null}
              {emailVerificationMessage ? <p className="form-success">{emailVerificationMessage}</p> : null}
              {emailVerificationChallengeId ? (
                <label>
                  <span>Verification Code *</span>
                  <input
                    autoComplete="one-time-code"
                    disabled={emailVerificationVerifying || Boolean(confirmation)}
                    inputMode="numeric"
                    maxLength="6"
                    name="registration-verification-code"
                    onChange={(inputEvent) => {
                      setEmailVerificationCode(inputEvent.target.value.replace(/\D/g, '').slice(0, 6));
                      setEmailVerificationError('');
                    }}
                    type="text"
                    value={emailVerificationCode}
                  />
                </label>
              ) : null}
              <button
                className="button-link button-reset"
                disabled={emailVerificationChallengeId
                  ? emailVerificationVerifying || emailVerificationCode.length !== 6
                  : emailVerificationSending}
                type="button"
                onClick={emailVerificationChallengeId
                  ? handleVerifyEmailCode
                  : handleStartEmailVerification}
              >
                {emailVerificationChallengeId
                  ? emailVerificationVerifying ? 'Verifying...' : 'Verify Code And Continue'
                  : emailVerificationSending ? 'Sending Code...' : 'Send Verification Code'}
              </button>
              {emailVerificationChallengeId ? (
                <button
                  className="text-button"
                  disabled={emailVerificationSending || emailVerificationVerifying}
                  type="button"
                  onClick={handleStartEmailVerification}
                >
                  {emailVerificationSending ? 'Sending...' : 'Send A New Code'}
                </button>
              ) : null}
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
                      onWalletTokenReady={setSquareWalletToken}
                      onlinePaymentRequired={requiresSquarePayment}
                      reservation={paymentReservation}
                      reservationError={paymentReservationError}
                      reservationLoading={paymentReservationLoading}
                      selectedPaymentToken={squareWalletToken}
                    />
                  ) : null}
                  {submitting ? (
                    <p className="form-success">
                      {registrationFinalizing
                        ? 'Registration saved. Preparing confirmation...'
                        : 'Submitting registration and preparing confirmation...'}
                    </p>
                  ) : null}
                  <button
                    className="button-link button-reset"
                    disabled={submitting
                      || Boolean(registrationUnavailable)
                      || (requiresSquarePayment && (!squareCard && !squareWalletToken || Boolean(squareError && !squareWalletToken)))
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

  if (lookup.status === 'profile-verification-required') {
    return (
      <div className="registration-lookup-card">
        <strong>Profile Found</strong>
        <span>Verify your identity to view and use the profile information connected to this email.</span>
      </div>
    );
  }

  if (lookup.status === 'email-verification-required') {
    return (
      <div className="registration-lookup-card">
        <strong>Email Verification Required</strong>
        <span>Verify this email address before entering registration information.</span>
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
  const registrationStartDate = getRegistrationStartDate(event);
  const registrationEndDate = getRegistrationEndDate(event);

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
        {event.eventType !== 'Challenges' ? (
          <div>
            <dt>Time</dt>
            <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
          </div>
        ) : null}
        {registrationStartDate || registrationEndDate ? (
          <div>
            <dt>Registration Open/Closes</dt>
            <dd>{formatRegistrationDateRange(event)}</dd>
          </div>
        ) : null}
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
  const registrationStartDate = getRegistrationStartDate(event);
  const registrationEndDate = getRegistrationEndDate(event);

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
        {event.eventType !== 'Challenges' ? (
          <div>
            <dt>Time</dt>
            <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
          </div>
        ) : null}
        {registrationStartDate || registrationEndDate ? (
          <div>
            <dt>Registration Open/Closes</dt>
            <dd>{formatRegistrationDateRange(event)}</dd>
          </div>
        ) : null}
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
  onWalletTokenReady,
  onlinePaymentRequired,
  reservation,
  reservationError,
  reservationLoading,
  selectedPaymentToken
}) {
  const applePayRef = useRef(null);
  const cardContainerId = useRef(`square-card-${Math.random().toString(36).slice(2)}`);
  const googlePayContainerId = useRef(`square-google-pay-${Math.random().toString(36).slice(2)}`);
  const [localError, setLocalError] = useState('');
  const [loading, setLoading] = useState(false);
  const [testCardMessage, setTestCardMessage] = useState('');
  const [walletMessage, setWalletMessage] = useState('');
  const [walletProcessing, setWalletProcessing] = useState('');
  const [reservationTimeLeft, setReservationTimeLeft] = useState('');
  const [walletSupport, setWalletSupport] = useState({
    applePay: false,
    googlePay: false
  });
  const handleWalletPayment = useCallback(async (paymentMethod, walletName) => {
    if (!paymentMethod || disabled) {
      return;
    }

    setLocalError('');
    setWalletMessage('');
    setWalletProcessing(walletName);
    onWalletTokenReady('');

    try {
      const tokenResult = await paymentMethod.tokenize();

      if (tokenResult.status !== 'OK') {
        throw new Error(getSquareTokenizeError(tokenResult));
      }

      onWalletTokenReady(tokenResult.token);
      setWalletMessage(`${walletName} authorized. Click Submit Registration to finish.`);
    } catch (walletError) {
      onWalletTokenReady('');
      setLocalError(walletError.message || `${walletName} could not be verified.`);
    } finally {
      setWalletProcessing('');
    }
  }, [disabled, onWalletTokenReady]);

  useEffect(() => {
    if (!reservation?.expiresAt) {
      setReservationTimeLeft('');
      return undefined;
    }

    function updateCountdown() {
      const millisLeft = Date.parse(reservation.expiresAt) - Date.now();

      if (millisLeft <= 0) {
        setReservationTimeLeft('expired');
        return;
      }

      const minutes = Math.floor(millisLeft / 60000);
      const seconds = Math.floor((millisLeft % 60000) / 1000);

      setReservationTimeLeft(`${minutes}:${String(seconds).padStart(2, '0')}`);
    }

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 1000);

    return () => window.clearInterval(intervalId);
  }, [reservation]);

  useEffect(() => {
    if (!onlinePaymentRequired || !config?.enabled) {
      onCardReady(null);
      onWalletTokenReady('');
      setWalletSupport({ applePay: false, googlePay: false });
      return undefined;
    }

    let cancelled = false;
    let cardInstance = null;
    let googlePayClickHandler = null;
    let googlePayContainer = null;
    let walletInstances = [];

    async function initializeSquarePayments() {
      setLoading(true);
      setLocalError('');
      setWalletMessage('');
      onWalletTokenReady('');
      setWalletSupport({ applePay: false, googlePay: false });

      try {
        validateSquarePaymentConfig(config);
        await loadSquareScript(config.scriptUrl);

        if (!window.Square) {
          throw new Error('Square payment form could not be loaded.');
        }

        const payments = window.Square.payments(config.applicationId, config.locationId);
        const paymentRequest = buildSquarePaymentRequest(payments, amountDue);

        if (config.enableCardPayments !== false) {
          cardInstance = await payments.card();
          await cardInstance.attach(`#${cardContainerId.current}`);

          if (!cancelled) {
            onCardReady(cardInstance);
          }
        }

        if (config.enableApplePay) {
          try {
            const applePay = await payments.applePay(paymentRequest);
            walletInstances.push(applePay);

            if (!cancelled) {
              applePayRef.current = applePay;
              setWalletSupport((current) => ({ ...current, applePay: true }));
            }
          } catch {
            if (!cancelled) {
              applePayRef.current = null;
              setWalletSupport((current) => ({ ...current, applePay: false }));
            }
          }
        }

        if (config.enableGooglePay) {
          try {
            const googlePay = await payments.googlePay(paymentRequest);
            walletInstances.push(googlePay);
            googlePayContainer = document.getElementById(googlePayContainerId.current);

            await googlePay.attach(`#${googlePayContainerId.current}`);

            googlePayClickHandler = (clickEvent) => {
              clickEvent.preventDefault();
              handleWalletPayment(googlePay, 'Google Pay');
            };
            googlePayContainer?.addEventListener('click', googlePayClickHandler);

            if (!cancelled) {
              setWalletSupport((current) => ({ ...current, googlePay: true }));
            }
          } catch {
            if (!cancelled) {
              setWalletSupport((current) => ({ ...current, googlePay: false }));
            }
          }
        }
      } catch (squareLoadError) {
        if (!cancelled) {
          onCardReady(null);
          onWalletTokenReady('');
          setLocalError(squareLoadError.message || 'Square payment form could not be loaded.');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initializeSquarePayments();

    return () => {
      cancelled = true;
      onCardReady(null);
      onWalletTokenReady('');
      applePayRef.current = null;

      if (googlePayContainer && googlePayClickHandler) {
        googlePayContainer.removeEventListener('click', googlePayClickHandler);
      }

      if (cardInstance && typeof cardInstance.destroy === 'function') {
        cardInstance.destroy();
      }

      walletInstances.forEach((paymentMethod) => {
        if (paymentMethod && typeof paymentMethod.destroy === 'function') {
          paymentMethod.destroy();
        }
      });
    };
  }, [amountDue, config, handleWalletPayment, onCardReady, onWalletTokenReady, onlinePaymentRequired]);

  return (
    <div className="registration-payment-panel">
      <strong>Payment</strong>
      <span className="form-help">
        Amount due: {formatCurrency(amountDue)}
      </span>
      <p className="form-help">
        Card, Apple Pay, and Google Pay information is entered directly into Square&apos;s secure payment form.
        The Village Quilters Network does not store your card number, security code, or wallet payment details.
      </p>
      {!onlinePaymentRequired ? (
        <p className="form-help">Cash/check later is selected, so online card payment is not needed now.</p>
      ) : null}
      {onlinePaymentRequired ? (
        <>
          {reservationLoading || (!reservation && !reservationError) ? (
            <p className="form-help">Holding your seat for online payment...</p>
          ) : null}
          {reservationError ? <p className="form-error">{reservationError}</p> : null}
          {reservationTimeLeft ? (
            <p className={reservationTimeLeft === 'expired' ? 'form-error' : 'form-success'}>
              {reservationTimeLeft === 'expired'
                ? 'Your payment seat hold expired. Submit again to start a new hold.'
                : `Your seat is held for ${reservationTimeLeft} while you complete payment.`}
            </p>
          ) : null}
          {walletSupport.applePay || walletSupport.googlePay ? (
            <div className="square-wallet-section">
              {walletSupport.applePay ? (
                <button
                  aria-label="Pay with Apple Pay"
                  className="square-apple-pay-button"
                  disabled={disabled || Boolean(walletProcessing)}
                  type="button"
                  onClick={() => handleWalletPayment(applePayRef.current, 'Apple Pay')}
                >
                  {walletProcessing === 'Apple Pay' ? 'Authorizing Apple Pay...' : ''}
                </button>
              ) : null}
              {walletSupport.googlePay ? (
                <div
                  aria-label="Pay with Google Pay"
                  className={`square-google-pay-container${disabled || walletProcessing ? ' is-disabled' : ''}`}
                  id={googlePayContainerId.current}
                />
              ) : null}
              {walletMessage ? <p className="form-success">{walletMessage}</p> : null}
            </div>
          ) : null}
          {config?.environment === 'sandbox' && config?.enableCardPayments !== false ? (
            <div className="sandbox-card-helper">
              <strong>Sandbox Test Card</strong>
              <button
                className="button-link button-reset compact-action"
                type="button"
                onClick={() => selectSandboxTestPayment(onWalletTokenReady, setTestCardMessage)}
              >
                {selectedPaymentToken === 'cnon:card-nonce-ok' ? 'Test Card Selected' : 'Use Test Card'}
              </button>
              <span>
                {selectedPaymentToken === 'cnon:card-nonce-ok'
                  ? 'Square sandbox test payment is ready. No card fields need to be typed.'
                  : 'Uses Square sandbox token cnon:card-nonce-ok.'}
              </span>
              {testCardMessage ? <span className="form-help">{testCardMessage}</span> : null}
            </div>
          ) : null}
          {config?.enableCardPayments !== false && selectedPaymentToken !== 'cnon:card-nonce-ok' ? (
            <>
              {(walletSupport.applePay || walletSupport.googlePay) ? (
                <span className="form-help">Or enter a card:</span>
              ) : null}
              <div
                aria-label="Secure Square card payment form"
                className={`square-card-container${disabled ? ' is-disabled' : ''}`}
                id={cardContainerId.current}
              />
            </>
          ) : null}
          {selectedPaymentToken === 'cnon:card-nonce-ok' ? (
            <p className="form-success">
              Test payment selected. Click Submit Registration to complete the sandbox payment.
            </p>
          ) : null}
          {config?.enableCardPayments === false && !walletSupport.applePay && !walletSupport.googlePay ? (
            <p className="form-error">
              No enabled online payment methods are available in this browser.
            </p>
          ) : null}
          {loading ? <p className="form-help">Loading secure payment form...</p> : null}
          {error || localError ? <p className="form-error">{error || localError}</p> : null}
        </>
      ) : null}
    </div>
  );
}

function selectSandboxTestPayment(onWalletTokenReady, setMessage) {
  onWalletTokenReady('cnon:card-nonce-ok');
  setMessage('Test payment selected. Click Submit Registration to finish.');
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

function validateSquarePaymentConfig(config) {
  const applicationId = String(config?.applicationId || '').trim();
  const locationId = String(config?.locationId || '').trim();
  const expectedAppIdPrefix = config?.environment === 'production'
    ? 'sq0idp-'
    : 'sandbox-sq0idb-';

  if (!applicationId || !locationId) {
    throw new Error('Online payment setup is missing the Square application ID or location ID.');
  }

  if (!applicationId.startsWith(expectedAppIdPrefix)) {
    throw new Error(
      `Online payment setup has an invalid Square application ID. Check SQUARE_APPLICATION_ID in Vercel; it should start with ${expectedAppIdPrefix}.`
    );
  }
}

function buildSquarePaymentRequest(payments, amountDue) {
  return payments.paymentRequest({
    countryCode: 'US',
    currencyCode: 'USD',
    total: {
      amount: Number(amountDue || 0).toFixed(2),
      label: 'The Village Quilters'
    }
  });
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

function isPaymentReservationActive(reservation) {
  return Boolean(
    reservation?.reservationId
      && reservation?.expiresAt
      && Date.parse(reservation.expiresAt) > Date.now()
  );
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
  billingPostalCode,
  billingState,
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
