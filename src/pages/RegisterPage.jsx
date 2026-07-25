import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import { US_STATES } from '../data/usStates.js';
import { useEventRegistration } from '../hooks/useEventRegistration.js';
import { useIdentityVerification } from '../hooks/useIdentityVerification.js';
import {
  getSquareTokenizeError,
  isPaymentReservationActive,
  usePaymentReservation
} from '../hooks/usePaymentReservation.js';
import { useRegistrantForm } from '../hooks/useRegistrantForm.js';
import { createRegistration } from '../services/registrationService.js';
import {
  formatCurrency,
  formatEventDate,
  formatRegistrationDateRange,
  formatTimeRange,
  getRegistrationEndDate,
  getRegistrationStartDate
} from '../utils/eventFormat.js';
import {
  canPayLaterByCashCheck as getCanPayLaterByCashCheck,
  canShowRegistrantFields as getCanShowRegistrantFields,
  getEventPaymentTotal,
  getProfileExists,
  getRegistrationUnavailableReason,
  isMembershipBlocked,
  needsAccountPassword as getNeedsAccountPassword,
  needsEmailVerification as getNeedsEmailVerification,
  requiresBillingAddress as getRequiresBillingAddress
} from '../utils/registrationEligibility.js';
import {
  buildBillingAddress,
  buildDisplayName,
  formatPhoneNumber,
  toTitleCase
} from '../utils/profileFormat.js';

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
  const {
    displayedTermsVersion,
    event,
    eventError,
    loadingEvent,
    membershipSettings
  } = useEventRegistration(eventId);
  const {
    applyProfile: applyProfileToForm,
    billingCity,
    billingCountry,
    billingPostalCode,
    billingState,
    billingStreet,
    fieldErrors,
    firstName,
    lastName,
    phone,
    reset: resetRegistrantFields,
    setBillingCity,
    setBillingCountry,
    setBillingPostalCode,
    setBillingState,
    setBillingStreet,
    setFieldErrors,
    setFirstName,
    setLastName,
    setPhone
  } = useRegistrantForm();
  const [closeMessage, setCloseMessage] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [formError, setFormError] = useState('');
  const [needsProfileEdits, setNeedsProfileEdits] = useState(false);
  const [paymentPreference, setPaymentPreference] = useState('');
  const [registrationFinalizing, setRegistrationFinalizing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const registrationAttemptKey = useRef(createRegistrationAttemptKey());

  // usePaymentReservation is declared below because it needs
  // buildRegistrationRequest, which in turn needs identity state from
  // useIdentityVerification. Identity lookups still have to drop any live
  // seat hold, so the reset is reached through a ref. Lookups are always
  // async, so the ref is populated long before it is called.
  const resetPaymentReservationRef = useRef(() => {});
  const resetSubmissionAndPaymentReservation = useCallback(() => {
    setConfirmation(null);
    resetPaymentReservationRef.current();
  }, []);

  const {
    accountVerified,
    authError,
    authPassword,
    authSubmitting,
    email,
    emailVerificationChallengeId,
    emailVerificationCode,
    emailVerificationError,
    emailVerificationMessage,
    emailVerificationSending,
    emailVerificationVerifying,
    emailVerified,
    handleEmailChange,
    handleEmailLookup,
    handlePasswordSignIn,
    handleStartEmailVerification,
    handleVerifyEmailCode,
    lookup,
    lookupComplete,
    lookupLoading,
    reactivateProfile,
    reactivationTermsAccepted,
    registrationVerificationToken,
    setAuthError,
    setAuthPassword,
    setEmailVerificationCode,
    setEmailVerificationError,
    setReactivationTermsAccepted,
    showEmailVerification
  } = useIdentityVerification({
    applyProfile: applyProfileToForm,
    currentUser,
    eventId,
    onBeforeLookup: resetSubmissionAndPaymentReservation,
    reset: resetRegistrantFields,
    setFieldErrors,
    setFormError,
    userProfile
  });

  useEffect(() => {
    setPaymentPreference('');
  }, [eventId]);

  const membershipBlocked = isMembershipBlocked({ lookup, lookupComplete });
  const matchedProfile = lookup?.profile || null;
  const profileExists = getProfileExists(lookup);
  const requiresBillingAddress = getRequiresBillingAddress(event);
  const canPayLaterByCashCheck = getCanPayLaterByCashCheck(event);
  const showAddressFields = requiresBillingAddress || Boolean(matchedProfile);

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
      idempotencyKey: registrationAttemptKey.current,
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

  const registrationUnavailable = useMemo(
    () => getRegistrationUnavailableReason(event),
    [event]
  );

  const needsAccountPassword = getNeedsAccountPassword({
    accountVerified,
    emailVerified,
    lookupComplete,
    membershipBlocked,
    profileExists,
    showEmailVerification
  });
  const needsEmailVerification = getNeedsEmailVerification({
    emailVerified,
    lookup,
    lookupComplete,
    membershipBlocked,
    profileExists,
    showEmailVerification
  });
  const canShowRegistrantFields = getCanShowRegistrantFields({
    accountVerified,
    emailVerified,
    lookupComplete,
    membershipBlocked
  });
  const usingSignedInProfile = Boolean(currentUser && userProfile?.email);
  const requiresReactivationTerms = Boolean(
    reactivateProfile
      && matchedProfile
      && matchedProfile.status !== 'Active'
      && !confirmation
  );

  // Collapses the caller-side half of the auto-reserve guard. The hook adds
  // the payment-side conditions (a paid event needing Square, no live hold).
  const readyToReserve = canShowRegistrantFields
    && !needsProfileEdits
    && !confirmation
    && Boolean(email)
    && (accountVerified || emailVerified);

  const {
    ensurePaymentReservation,
    isPaidEvent,
    joiningWaitlist,
    markReservationExpired,
    paymentRequiredForCurrentSeat,
    paymentReservation,
    paymentReservationError,
    paymentReservationExpired,
    paymentReservationLoading,
    requiresSquarePayment,
    resetPaymentReservation,
    setSquareCard,
    setSquareWalletToken,
    squareCard,
    squareConfig,
    squareError,
    squareWalletToken,
    tokenizeSquarePayment
  } = usePaymentReservation({
    buildRegistrationRequest,
    event,
    eventId,
    paymentPreference,
    readyToReserve,
    registrant: {
      billingCity,
      billingCountry,
      billingPostalCode,
      billingState,
      billingStreet,
      email,
      firstName,
      lastName,
      phone
    }
  });

  resetPaymentReservationRef.current = resetPaymentReservation;

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
          : await ensurePaymentReservation()
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

  const handleClose = useCallback(() => {
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
  }, [navigate, returnTarget]);

  const handleCompletionClose = useCallback(() => {
    if (returnTarget) {
      window.location.assign(returnTarget);
      return;
    }

    navigate('/events');
  }, [navigate, returnTarget]);

  const handlePaymentReservationExpired = useCallback(() => {
    markReservationExpired();
    window.setTimeout(() => {
      if (returnTarget) {
        window.location.assign(returnTarget);
        return;
      }

      navigate('/events');
    }, 1500);
  }, [markReservationExpired, navigate, returnTarget]);

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
                handleEmailChange(inputEvent.target.value);
                setNeedsProfileEdits(false);
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
                      onEnsureReservation={ensurePaymentReservation}
                      onReservationExpired={handlePaymentReservationExpired}
                      onWalletTokenReady={setSquareWalletToken}
                      onlinePaymentRequired={paymentRequiredForCurrentSeat}
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
                      || paymentReservationExpired
                      || (paymentRequiredForCurrentSeat && (!squareCard && !squareWalletToken || Boolean(squareError && !squareWalletToken)))
                      || (requiresReactivationTerms && !reactivationTermsAccepted)}
                    type="submit"
                  >
                    {submitting
                      ? 'Submitting...'
                      : joiningWaitlist
                        ? 'Add Me To The Waitlist'
                        : 'Submit Registration'}
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
          Return To List
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
  onEnsureReservation,
  onReservationExpired,
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
  const reservationExpiredHandled = useRef(false);
  const selectedPaymentTokenRef = useRef(selectedPaymentToken);
  const [walletSupport, setWalletSupport] = useState({
    applePay: false,
    googlePay: false
  });

  useEffect(() => {
    selectedPaymentTokenRef.current = selectedPaymentToken;
  }, [selectedPaymentToken]);

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
      reservationExpiredHandled.current = false;
      return undefined;
    }

    reservationExpiredHandled.current = false;

    function updateCountdown() {
      const millisLeft = Date.parse(reservation.expiresAt) - Date.now();

      if (millisLeft <= 0) {
        setReservationTimeLeft('expired');
        if (!reservationExpiredHandled.current) {
          reservationExpiredHandled.current = true;
          onReservationExpired();
        }
        return;
      }

      const minutes = Math.floor(millisLeft / 60000);
      const seconds = Math.floor((millisLeft % 60000) / 1000);

      setReservationTimeLeft(`${minutes}:${String(seconds).padStart(2, '0')}`);
    }

    updateCountdown();
    const intervalId = window.setInterval(updateCountdown, 1000);

    return () => window.clearInterval(intervalId);
  }, [onReservationExpired, reservation]);

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
          if (selectedPaymentTokenRef.current === 'cnon:card-nonce-ok') {
            onCardReady(null);
            return;
          }

          cardInstance = await payments.card();
          const cardContainer = document.getElementById(cardContainerId.current);

          if (!cardContainer || selectedPaymentTokenRef.current === 'cnon:card-nonce-ok') {
            onCardReady(null);
            return;
          }

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
          if (selectedPaymentTokenRef.current !== 'cnon:card-nonce-ok') {
            onWalletTokenReady('');
            setLocalError(squareLoadError.message || 'Square payment form could not be loaded.');
          }
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
        <p className={reservation?.status === 'Waitlisted' ? 'waitlist-notice' : 'form-help'}>
          {reservation?.status === 'Waitlisted'
            ? 'No seat is currently available. Submit to join the waitlist; no payment is due now.'
            : 'Cash/check later is selected, so online card payment is not needed now.'}
        </p>
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
                ? 'Your payment seat hold expired. Returning you to the listing.'
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
                onClick={() => selectSandboxTestPayment({
                  onEnsureReservation,
                  onWalletTokenReady,
                  setLocalError,
                  setMessage: setTestCardMessage
                })}
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
          {config?.enableCardPayments !== false ? (
            <>
              {(walletSupport.applePay || walletSupport.googlePay) && selectedPaymentToken !== 'cnon:card-nonce-ok' ? (
                <span className="form-help">Or enter a card:</span>
              ) : null}
              <div
                aria-label="Secure Square card payment form"
                className={`square-card-container${disabled ? ' is-disabled' : ''}${selectedPaymentToken === 'cnon:card-nonce-ok' ? ' is-test-token-selected' : ''}`}
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

async function selectSandboxTestPayment({
  onEnsureReservation,
  onWalletTokenReady,
  setLocalError,
  setMessage
}) {
  setLocalError('');
  setMessage('Starting seat hold...');

  try {
    await onEnsureReservation();
    onWalletTokenReady('cnon:card-nonce-ok');
    setMessage('Test payment selected. Click Submit Registration to finish.');
  } catch (error) {
    onWalletTokenReady('');
    setMessage('');
    setLocalError(error.message || 'Payment seat hold could not be created.');
  }
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

function createRegistrationAttemptKey() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
