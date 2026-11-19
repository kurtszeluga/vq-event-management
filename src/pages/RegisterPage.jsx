import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import PageHeader from '../components/PageHeader.jsx';
import RegistrationPaymentPanel from '../components/RegistrationPaymentPanel.jsx';
import SeatHoldStatus from '../components/SeatHoldStatus.jsx';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../lib/firebase.js';
import { useAuth } from '../context/useAuth.js';
import { US_STATES } from '../data/usStates.js';
import { useEventRegistration } from '../hooks/useEventRegistration.js';
import { useIdentityVerification } from '../hooks/useIdentityVerification.js';
import {
  isPaymentReservationActive,
  usePaymentReservation
} from '../hooks/usePaymentReservation.js';
import { useProfileEditing } from '../hooks/useProfileEditing.js';
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
  mustPayByCashCheck as getMustPayByCashCheck,
  needsAccountPassword as getNeedsAccountPassword,
  needsMembershipTerms as getNeedsMembershipTerms,
  showsRegistrantFields,
  needsEmailVerification as getNeedsEmailVerification,
  requiresBillingAddress as getRequiresBillingAddress
} from '../utils/registrationEligibility.js';
import { getEventCostOn, isMembershipEvent } from '../../shared/membershipDues.js';
import { UNLISTED_EVENT_TYPES } from '../data/eventOptions.js';
import {
  MEMBERSHIP_PHONE_TYPES,
  MEMBERSHIP_RENEWAL_TYPES,
  MEMBERSHIP_SKILLS_MAX_LENGTH,
  MEMBERSHIP_VETERAN_ANSWERS,
  getMembershipAnswerErrors
} from '../../shared/membershipQuestions.js';
import {
  buildBillingAddress,
  buildDisplayName,
  formatPhoneNumber,
  toTitleCase
} from '../utils/profileFormat.js';

function RegisterPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { eventId: routeEventId = '' } = useParams();
  const { currentUser, logOut, userProfile } = useAuth();
  const eventId = searchParams.get('eventId') || routeEventId || '';
  const returnUrl = getSafeReturnUrl(searchParams.get('returnUrl') || '');
  const referrerUrl = getExternalReferrerUrl();
  const returnTarget = returnUrl || referrerUrl;
  // The admin dashboard tracks its open module in memory, not in the URL, so a
  // plain history step lands on the module chooser rather than the list the
  // admin clicked Register Myself from. The link stashes the module it was on,
  // the same way the Print Registration List link already did.
  const location = useLocation();
  const returnModule = location.state?.module || '';
  const {
    displayedTermsVersion,
    event,
    eventError,
    loadingEvent,
    membershipSettings
  } = useEventRegistration(eventId);
  const isMembershipRegistration = isMembershipEvent(event);
  // A type that appears in no list is reached only by a link posted
  // elsewhere, so the site chrome around it offers a way "back" to places
  // this page was never part of. The body class is what hides it; the
  // breadcrumb is dropped below at the PageHeader itself.
  const isStandaloneSignup = UNLISTED_EVENT_TYPES.includes(event?.eventType);
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
  const [wantsPasswordSetup, setWantsPasswordSetup] = useState(false);
  const [passwordSetupPromptOpen, setPasswordSetupPromptOpen] = useState(false);
  // Asked once. Without the ref the effect below would re-open the dialog on
  // every later render that still satisfies the condition, so declining it
  // would not stick.
  const passwordSetupAskedRef = useRef(false);
  const [passwordHandoffOpen, setPasswordHandoffOpen] = useState(false);
  const passwordHandoffRaisedRef = useRef(false);
  const [passwordSetupPending, setPasswordSetupPending] = useState(false);
  const [passwordSetupError, setPasswordSetupError] = useState('');
  const [formError, setFormError] = useState('');
  // The four questions a Membership signup asks on top of the usual contact
  // details. Held here rather than in a generic answers map because they are
  // four fixed questions, not a question builder - see PROJECT_SPEC.md.
  // Where a standalone signup ends. Not a route: navigating anywhere would
  // land the member on a page they are deliberately not allowed to reach, and
  // every existing exit from this form goes to /events - a list this signup is
  // not in. Rendering a terminal card instead means there is nothing to click
  // and nowhere to go, which is what was asked for.
  const [standaloneExit, setStandaloneExit] = useState('');
  // Membership dues buy guild membership, so the signup has to take the same
  // agreement /signup does, from the same configured text and version. Held
  // separately from reactivationTermsAccepted: that one answers "reinstate my
  // archived profile", this one answers "I am joining the guild", and a
  // single flag would let either stand in for the other.
  const [membershipTermsAccepted, setMembershipTermsAccepted] = useState(false);
  const [membershipPhoneType, setMembershipPhoneType] = useState('');
  const [membershipRenewalType, setMembershipRenewalType] = useState('');
  const [membershipVeteran, setMembershipVeteran] = useState('');
  const [membershipSkills, setMembershipSkills] = useState('');
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
    passwordSetupToken,
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
    codeOnlyVerification: isStandaloneSignup,
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
  const mustPayByCashCheck = getMustPayByCashCheck(event);
  const showAddressFields = requiresBillingAddress || Boolean(matchedProfile);

  const {
    handleCancelProfileEdit,
    handleSaveProfileEdit,
    handleStartProfileEdit,
    needsProfileEdits,
    setNeedsProfileEdits
  } = useProfileEditing({
    applyProfile: applyProfileToForm,
    matchedProfile,
    registrant: {
      billingCity,
      billingCountry,
      billingPostalCode,
      billingState,
      billingStreet,
      firstName,
      lastName,
      phone
    },
    setFieldErrors,
    setFormError
  });

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
      membershipAnswers: {
        phoneType: membershipPhoneType,
        renewalType: membershipRenewalType,
        skills: membershipSkills,
        veteran: membershipVeteran
      },
      name: displayName,
      paymentPreference: canPayLaterByCashCheck
        ? (mustPayByCashCheck ? 'cash-check-later' : paymentPreference)
        : '',
      phone,
      profileUserId: matchedProfile?.userId || '',
      profileUpdates,
      reactivateProfile,
      reactivationTermsAccepted,
      // Recorded against the registration, not only acted on in the browser.
      // A dues record whose agreement exists solely as a disabled button is
      // not a record of anything.
      termsAccepted: membershipTermsAccepted,
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
    membershipTermsAccepted,
    membershipPhoneType,
    membershipRenewalType,
    membershipSkills,
    membershipVeteran,
    mustPayByCashCheck,
    paymentPreference,
    phone,
    reactivateProfile,
    reactivationTermsAccepted,
    registrationVerificationToken,
    requiresBillingAddress
  ]);


  useEffect(() => {
    document.body.classList.toggle('signup-standalone', isStandaloneSignup);

    return () => {
      document.body.classList.remove('signup-standalone');
    };
  }, [isStandaloneSignup]);

  const registrationUnavailable = useMemo(
    () => getRegistrationUnavailableReason(event),
    [event]
  );

  // Never on a standalone signup. There is no password step here, and while
  // the code is being sent this condition is briefly true - a profile exists
  // and the code panel is not open yet - which flashed an "Account Found"
  // card for the length of the request.
  const needsAccountPassword = !isStandaloneSignup && getNeedsAccountPassword({
    accountVerified,
    emailVerified,
    lookupComplete,
    membershipBlocked,
    profileExists,
    showEmailVerification
  });
  // Kept shut while the code request is still in flight on a standalone
  // signup. The gate below opens for any address with no profile as soon as
  // the lookup completes, which is before the code exists - and a panel with
  // no challenge renders a "Send Verification Code" button, offering the
  // action just taken. The Submit button reads "Sending..." during this.
  const needsEmailVerification = !(isStandaloneSignup && lookupLoading) && getNeedsEmailVerification({
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
  // Deliberately false on a standalone signup, whoever is signed in. The
  // guild account stays signed in on shared machines, and on a public dues
  // link that produced "this registration will be for
  // webmaster@villagequilters.com" with the address locked - naming the wrong
  // person and offering no way to correct it.
  //
  // Safe because authorization never depended on this flag:
  // getMatchingUserIdToken only attaches a token when the signed-in address
  // equals the one being registered, so anyone else goes through the emailed
  // code exactly as an anonymous visitor does.
  const usingSignedInProfile = Boolean(currentUser && userProfile?.email)
    && !isStandaloneSignup;

  // Signing out is the only honest way to register a different address while
  // signed in. The server refuses the alternative outright - createRegistration
  // and beginSquarePaymentReservation both reject a Firebase-authorized request
  // whose email resolves to another profile ("The signed-in account is not
  // linked to this member profile"), so an editable box here would only move
  // the failure to the end of the form, after the card details.
  //
  // Lands back on this same signup, signed out, with the email box empty and
  // ready to verify by code.
  // Back to an empty box and the Submit button, discarding the code that was
  // sent. handleEmailChange is what clears the challenge, the lookup and the
  // registrant fields; this just gives that a control of its own.
  function handleResetEmailEntry() {
    setFormError('');
    handleEmailChange('');
    setNeedsProfileEdits(false);
  }

  async function handleUseDifferentEmail() {
    setFormError('');

    try {
      await logOut();
      handleEmailChange('');
    } catch (error) {
      setFormError(error.message || 'We could not sign you out. Please try again.');
    }
  }
  const requiresMembershipTerms = getNeedsMembershipTerms({
    canShowRegistrantFields,
    confirmed: Boolean(confirmation),
    isStandaloneSignup
  });
  const requiresReactivationTerms = Boolean(
    reactivateProfile
      && matchedProfile
      && matchedProfile.status !== 'Active'
      && !confirmation
  );

  // Collapses the caller-side half of the auto-reserve guard. The hook adds
  // the payment-side conditions (a paid event needing Square, no live hold).
  // Only worth offering to someone who actually arrived by code and has an
  // account to attach a password to. A token is only minted when the profile
  // exists, so its presence is the check.
  // Not on a temporary membership signup. The person came to pay their dues;
  // interrupting that with an offer to create a password is the account
  // machinery this signup exists to avoid.
  const offerPasswordSetup = emailVerified
    && Boolean(passwordSetupToken)
    && !isStandaloneSignup;

  // A card here was too easy to scroll past on the way to the rest of the
  // form, so the offer interrupts instead - it cannot be missed, and both
  // buttons are an answer.
  useEffect(() => {
    if (offerPasswordSetup && !passwordSetupAskedRef.current) {
      passwordSetupAskedRef.current = true;
      setPasswordSetupPromptOpen(true);
    }
  }, [offerPasswordSetup]);

  // The button alone was missed - it sits below the registration details on a
  // screen someone reads as "done". Since they already said yes at the code
  // step, and were told they would be taken there afterwards, this is that
  // promise arriving rather than a fresh question.
  useEffect(() => {
    if (confirmation && wantsPasswordSetup && passwordSetupToken && !passwordHandoffRaisedRef.current) {
      passwordHandoffRaisedRef.current = true;
      setPasswordHandoffOpen(true);
    }
  }, [confirmation, passwordSetupToken, wantsPasswordSetup]);


  const readyToReserve = canShowRegistrantFields
    && !needsProfileEdits
    && !confirmation
    && Boolean(email)
    && (accountVerified || emailVerified);

  const {
    ensurePaymentReservation,
    isPaidEvent,
    joiningWaitlist,
    paymentRequiredForCurrentSeat,
    paymentReservation,
    paymentReservationError,
    paymentReservationExpired,
    paymentReservationLoading,
    releaseCurrentReservation,
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
    const errors = validateForm({
      email,
      firstName,
      isMembershipRegistration,
      lastName,
      membershipPhoneType,
      membershipRenewalType,
      membershipSkills,
      membershipVeteran,
      phone
    });

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

    if (requiresMembershipTerms && !membershipTermsAccepted) {
      setFormError('You must read and agree to the Guild terms and conditions before signing up.');
      return;
    }

    if (requiresReactivationTerms && !reactivationTermsAccepted) {
      setFormError('You must read and agree to the terms and conditions before reactivating your profile.');
      return;
    }

    setSubmitting(true);

    try {
      const registrationRequest = buildRegistrationRequest();
      // Every registration holds a seat regardless of payment type now, so
      // this always resolves - only whether a Square token is also needed
      // stays conditional on requiresSquarePayment.
      const activePaymentReservation = isPaymentReservationActive(paymentReservation)
        ? paymentReservation
        : await ensurePaymentReservation();
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
      // Logged as well as shown. Square's SDK raises errors whose message is
      // its own generic "An unexpected error occurred", with the useful part
      // on the object rather than in the text - so without this there is
      // nothing for anyone to go on, which is exactly what was reported.
      console.error('Registration submit failed', error);
      setFormError(describeSubmitError(error));
    } finally {
      setSubmitting(false);
    }
  }

  // Every way out of this page runs this ladder, so Back and Cancel cannot
  // drift apart: an external return URL first, then the admin module that sent
  // us here, then a history step, and only then the caller's own fallback.
  const returnToOrigin = useCallback((fallback) => {
    if (returnTarget) {
      window.location.assign(returnTarget);
      return;
    }

    if (returnModule) {
      navigate('/admin', { state: { module: returnModule } });
      return;
    }

    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    fallback();
  }, [navigate, returnModule, returnTarget]);

  const handleClose = useCallback(() => {
    releaseCurrentReservation();

    // A standalone signup was opened from a link on another site, so there is
    // no origin to return to and window.close() only works for a tab the app
    // opened itself. Stop here instead.
    if (isStandaloneSignup) {
      setStandaloneExit('cancelled');
      return;
    }

    window.close();

    window.setTimeout(() => {
      returnToOrigin(() => {
        setCloseMessage('You can close this registration window or tab.');
      });
    }, 250);
  }, [isStandaloneSignup, releaseCurrentReservation, returnToOrigin]);

  const handleCompletionClose = useCallback(() => {
    if (isStandaloneSignup) {
      // Tried first because it is what the member actually wants - the signup
      // was opened from the guild website and there is nothing here to go
      // back to. It silently does nothing for a tab this app did not open,
      // which is most of them, so the terminal card is set either way and
      // becomes the visible result when the close does not happen.
      window.close();
      setStandaloneExit('completed');
      return;
    }

    if (returnTarget) {
      window.location.assign(returnTarget);
      return;
    }

    navigate('/events');
  }, [isStandaloneSignup, navigate, returnTarget]);

  // Same ladder as Cancel, by the user's own observation that the two should
  // not behave differently.
  const handleUnavailableReturn = useCallback(() => {
    if (isStandaloneSignup) {
      setStandaloneExit('cancelled');
      return;
    }

    returnToOrigin(() => navigate('/events'));
  }, [isStandaloneSignup, navigate, returnToOrigin]);

  // Running out of time sends the member back to the email box to start over,
  // on the same page. It used to throw them to the event listing instead,
  // which lost the page as well as the attempt - and on a standalone
  // Membership signup lost the only route back, since /events does not list
  // Membership.
  //
  // Starting over rather than stopping dead is the point: the alternative
  // leaves a form that is still full of their details but can no longer be
  // submitted, and no way to clear it. This puts the page back to the state
  // it opens in.
  //
  // resetPaymentReservation as well as the identity reset, because
  // handleEmailChange does not touch the hold - without it the cleared page
  // would still be carrying an expired reservation, and ensurePaymentReser-
  // vation would refuse to take a new one on the next attempt. Resetting it
  // cannot immediately re-reserve either: the auto-reserve effect needs a
  // verified email, which is exactly what has just been cleared.
  //
  // setFormError goes last. handleEmailChange resets the registrant form
  // underneath it, and this message is the only thing that explains why the
  // page they were filling in is suddenly empty.
  const handlePaymentReservationExpired = useCallback(() => {
    resetPaymentReservation();
    handleEmailChange('');
    setNeedsProfileEdits(false);
    setConfirmation(null);
    setFormError(
      'Your time to complete payment ran out, so nothing was charged and the form has been cleared. Enter your email address to start again.'
    );
  }, [handleEmailChange, resetPaymentReservation, setNeedsProfileEdits]);

  // Checked before every other branch: once a standalone signup has ended,
  // nothing else on this page should render, including the event summary and
  // the form it came from.
  if (standaloneExit) {
    return (
      <section className="standalone-signup-exit">
        <PageHeader
          eyebrow="Membership"
          title={standaloneExit === 'completed' ? 'Thank You' : 'Signup Cancelled'}
          description={standaloneExit === 'completed'
            ? 'Your membership signup is complete. A confirmation has been sent to your email address.'
            : 'Your signup was cancelled and nothing has been charged.'}
        />
        <p className="form-help">
          {standaloneExit === 'completed'
            ? 'You can close this window.'
            : 'You can close this window, or use the signup link again if you would like to start over.'}
        </p>
      </section>
    );
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

  // Both buttons are an answer, and either closes the dialog. Escape and the
  // backdrop route to the same place as No Thanks, so declining is always
  // possible - the point is that it cannot be scrolled past unanswered, not
  // that the member is trapped.
  function handleAcceptPasswordSetup() {
    setWantsPasswordSetup(true);
    setPasswordSetupPromptOpen(false);
  }

  function handleDeclinePasswordSetup() {
    setWantsPasswordSetup(false);
    setPasswordSetupPromptOpen(false);
  }

  // Deferred to here on purpose: the token was minted when the code was
  // verified, but signing in mid-registration would move the gates the rest of
  // the flow stands on. passwordSetup=1 puts the profile page into a mode that
  // focuses the password field, leaves the profile details alone, and signs
  // this provisional session out again if they leave without saving one -
  // otherwise abandoning it leaves a member signed in to an account that still
  // has no password.
  async function handleSetUpPassword() {
    setPasswordSetupError('');
    setPasswordSetupPending(true);

    try {
      await signInWithCustomToken(auth, passwordSetupToken);
      navigate('/profile?passwordSetup=1', { replace: true });
    } catch {
      // The registration itself already succeeded, so this must not read as a
      // registration failure - it is an optional extra that can be retried
      // from the login page's "forgot password" flow instead.
      setPasswordSetupError(
        'We could not open the password page. You can still set a password from the sign-in page using "Forgot password".'
      );
      setPasswordSetupPending(false);
    }
  }

  if (confirmation) {
    return (
      <section>
        <PageHeader
          breadcrumb={isStandaloneSignup ? undefined : [
            { label: 'Programs & Activities', to: '/events' },
            { label: event.title || event.eventType || 'Event', to: `/events/${event.id}` },
            { label: 'Registration Complete' }
          ]}
          eyebrow="Registration"
          title="Registration Complete"
          description="Your registration has been received."
        />
        <ConfirmDialog
          busy={passwordSetupPending}
          cancelLabel="Not Now"
          confirmLabel="Create Your Password"
          description={'Your registration is confirmed. Set your password now and you can sign in '
            + 'directly from then on, instead of waiting for a code each time. It takes a moment.'}
          error={passwordSetupError}
          open={passwordHandoffOpen}
          title="One Last Step"
          onCancel={() => setPasswordHandoffOpen(false)}
          onConfirm={handleSetUpPassword}
        />
        <div className="registration-layout">
          <EventSummary event={event} />
          <RegistrationCompletion
            closeMessage={closeMessage}
            confirmation={confirmation}
            event={event}
            passwordSetupError={passwordSetupError}
            passwordSetupPending={passwordSetupPending}
            onReturn={handleCompletionClose}
            returnLabel={isStandaloneSignup ? 'Close' : 'Return To List'}
            onSetUpPassword={wantsPasswordSetup && passwordSetupToken ? handleSetUpPassword : null}
          />
        </div>
      </section>
    );
  }

  // The form does not render at all once registration is closed. It used to
  // show the reason above a live card field and a submit button that was
  // merely disabled, which reads as a broken page rather than a closed one -
  // and the card field still mounted a Square iframe for a registration that
  // could never be submitted. Placed after the `confirmation` branch on
  // purpose: a member who has just registered keeps their confirmation even if
  // the window closes under them.
  if (registrationUnavailable) {
    return (
      <section>
        <PageHeader
          breadcrumb={isStandaloneSignup ? undefined : [
            { label: 'Programs & Activities', to: '/events' },
            { label: event.title || event.eventType || 'Event', to: `/events/${event.id}` },
            { label: 'Register' }
          ]}
          eyebrow="Registration"
          title="Registration Unavailable"
          description={registrationUnavailable}
        />
        <button
          className="button-link button-reset"
          onClick={handleUnavailableReturn}
          type="button"
        >
          Back
        </button>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        breadcrumb={isStandaloneSignup ? undefined : [
          { label: 'Programs & Activities', to: '/events' },
          { label: event.title || event.eventType || 'Event', to: `/events/${event.id}` },
          { label: 'Register' }
        ]}
        eyebrow="Registration"
        title={`Register For ${event.title}`}
        description={isStandaloneSignup
          ? 'Enter your email address and press Submit. We will email you a 6-digit code to confirm it, then you can fill in the rest of the form.'
          : 'Start with your email address so we can check your profile and membership.'}
      />
      <ConfirmDialog
        cancelLabel="No Thanks"
        confirmLabel="Yes, Set Up A Password"
        description={'This account has no password yet, which is why you signed in with a code. '
          + 'Setting one lets you sign in directly next time, and gives you the member directory '
          + 'and your registration history. Finish registering first - we will take you straight '
          + 'there afterwards so you do not lose your place.'}
        open={passwordSetupPromptOpen}
        title="Set Up A Password?"
        onCancel={handleDeclinePasswordSetup}
        onConfirm={handleAcceptPasswordSetup}
      />
      <div className="registration-layout">
        <EventSummary event={event} />
        <form className="form-panel registration-form" onSubmit={handleSubmit}>
          {/* Only while the submit button is out of reach. Once the form is
              long enough to have one, the copy beside the button is the one
              that gets read - see the matching block down there. */}
          {formError && !canShowRegistrantFields ? (
            <p className="form-error">{formError}</p>
          ) : null}
          {/* Hidden once the code is accepted: the registrant grid below
              carries the address read-only from that point, and leaving an
              editable copy above it offers a change that no longer does
              anything. */}
          {canShowRegistrantFields ? null : (
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
                You are signed in as <strong>{userProfile.email}</strong>, and
                this registration will be for that account. The address cannot
                be changed while you are signed in.
              </span>
            ) : null}
          </label>
          )}
          {usingSignedInProfile ? (
            <button
              className="button-link button-reset secondary-action"
              disabled={submitting || Boolean(confirmation)}
              type="button"
              onClick={handleUseDifferentEmail}
            >
              Sign Out And Use A Different Email
            </button>
          ) : null}
          {usingSignedInProfile ? (
            lookupLoading ? <p className="form-help">Checking your profile...</p> : null
          ) : (
            /* Shown whenever neither the code panel nor the form is on
               screen - stated in terms of what is visible rather than which
               flags are set, because the state that matters is the one with
               nothing else to press.
               
               That covers three cases: nothing entered yet, a code out (the
               panel owns the next step), and the form open (done). It also
               covers the one that was a dead end - a refused lookup, where
               the code panel has gone and the form will not open, and Submit
               is the only way to try a different address. */
            needsEmailVerification || canShowRegistrantFields ? null : (
            <button
              className="button-link button-reset"
              disabled={lookupLoading || submitting || Boolean(confirmation)}
              type="button"
              onClick={handleEmailLookup}
            >
              {lookupLoading ? 'Sending...' : 'Submit'}
            </button>
            )
          )}
          {/* The lookup card reports what the app found out about the
              address - an account, a membership status, a profile to edit.
              None of that is this signup's business on the happy path, and
              showing it would announce whether the address has an account
              before the person has proved it is theirs.
              
              But its OTHER branches are the refusals: already registered,
              membership not found, membership blocked. Hiding the card
              outright swallowed those too, and a refusal with nothing on
              screen is a dead end - the signup simply stopped, with an email
              box and a Cancel button and no reason given. So a blocked lookup
              still renders, which is also what makes the duplicate-signup
              guard visible to the person it is guarding against. */}
          {lookupComplete && (!isStandaloneSignup || membershipBlocked) ? (
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
              {/* Only before a code is on its way. Once one has been sent, the
                  message below says so, and "We will send..." sitting above
                  "We sent..." reads as though something is still pending. */}
              {emailVerificationChallengeId ? (
                <span>
                  Enter the six-digit code we emailed to <strong>{email}</strong>.
                  It expires in 10 minutes. Check your junk folder if it is not
                  there.
                </span>
              ) : (
                <span>
                  We will send a six-digit code to this email address so you can continue securely.
                </span>
              )}
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
              {/* The way back from a mistyped address. Clearing the field
                  already discards the challenge and brings Submit back, but
                  nothing on screen said so - and someone who has just sent a
                  code to an inbox they cannot read is exactly the person who
                  will not go hunting for it. Named for the problem rather
                  than the mechanism. */}
              {emailVerificationChallengeId ? (
                <button
                  className="text-button"
                  disabled={emailVerificationSending || emailVerificationVerifying}
                  type="button"
                  onClick={handleResetEmailEntry}
                >
                  Use A Different Email Address
                </button>
              ) : null}
            </div>
          ) : null}

          {canShowRegistrantFields ? (
            <>
              {showsRegistrantFields({ isStandaloneSignup, matchedProfile, needsProfileEdits }) ? (
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
              {isMembershipRegistration ? (
                <div className="membership-questions">
                  <h3>Membership Questions</h3>
                  <div
                    className={`radio-field ${fieldErrors.membershipPhoneType ? 'field-invalid' : ''}`}
                  >
                    <span>Select the type of phone *</span>
                    <div className="radio-options">
                      {MEMBERSHIP_PHONE_TYPES.map((option) => (
                        <label className="checkbox-label" key={option.value}>
                          <input
                            checked={membershipPhoneType === option.value}
                            disabled={submitting || Boolean(confirmation)}
                            name="membership-phone-type"
                            type="radio"
                            value={option.value}
                            onChange={() => setMembershipPhoneType(option.value)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div
                    className={`radio-field ${fieldErrors.membershipRenewalType ? 'field-invalid' : ''}`}
                  >
                    <span>Are you a New member or Renewing your membership? *</span>
                    <div className="radio-options">
                      {MEMBERSHIP_RENEWAL_TYPES.map((option) => (
                        <label className="checkbox-label" key={option.value}>
                          <input
                            checked={membershipRenewalType === option.value}
                            disabled={submitting || Boolean(confirmation)}
                            name="membership-renewal-type"
                            type="radio"
                            value={option.value}
                            onChange={() => setMembershipRenewalType(option.value)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <div
                    className={`radio-field ${fieldErrors.membershipVeteran ? 'field-invalid' : ''}`}
                  >
                    <span>Are you a Veteran? *</span>
                    <div className="radio-options">
                      {MEMBERSHIP_VETERAN_ANSWERS.map((option) => (
                        <label className="checkbox-label" key={option.value}>
                          <input
                            checked={membershipVeteran === option.value}
                            disabled={submitting || Boolean(confirmation)}
                            name="membership-veteran"
                            type="radio"
                            value={option.value}
                            onChange={() => setMembershipVeteran(option.value)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                  <label>
                    <span>
                      What skills set (previous work skills, quilting techniques
                      or designs, life experience and other talents) would you be
                      willing to share?
                    </span>
                    <textarea
                      disabled={submitting || Boolean(confirmation)}
                      maxLength={MEMBERSHIP_SKILLS_MAX_LENGTH}
                      rows={4}
                      value={membershipSkills}
                      onChange={(inputEvent) => setMembershipSkills(inputEvent.target.value)}
                    />
                    <span className="form-help">Optional.</span>
                  </label>
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
              {requiresMembershipTerms ? (
                <div className="membership-terms">
                  <div className="terms-panel">
                    <h3>Terms And Conditions</h3>
                    <p className="form-help">
                      Terms version: {displayedTermsVersion}
                    </p>
                    {membershipSettings.termsText ? (
                      <div className="terms-text">{membershipSettings.termsText}</div>
                    ) : (
                      <p className="form-help">
                        Please review the Guild membership terms and conditions
                        provided by the Guild before signing up.
                      </p>
                    )}
                  </div>
                  <label className="checkbox-label">
                    <input
                      checked={membershipTermsAccepted}
                      disabled={submitting || Boolean(confirmation)}
                      required
                      type="checkbox"
                      onChange={(inputEvent) => setMembershipTermsAccepted(inputEvent.target.checked)}
                    />
                    <span className="checkbox-label-copy">
                      <span>I have read and agree to the Guild terms and conditions.</span>
                      <span className="form-help">
                        Required before signing up for membership.
                      </span>
                    </span>
                  </label>
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
                  {canPayLaterByCashCheck && !mustPayByCashCheck ? (
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
                  {mustPayByCashCheck ? (
                    <p className="form-help">
                      This event is paid by cash or check only - no online payment option is offered.
                      Your spot will be registered now, and payment will remain pending until received.
                    </p>
                  ) : null}
                  {!isPaidEvent ? (
                    <p className="form-help">
                      This event is free - no payment is required.
                    </p>
                  ) : null}
                  {/* Membership only, deliberately. Any unlimited event has
                      the same non-existent deadline, but every other type
                      keeps the countdown it has always shown - this stays to
                      the one type it was asked for. */}
                  <SeatHoldStatus
                    joiningWaitlist={joiningWaitlist}
                    onExpired={handlePaymentReservationExpired}
                    reservation={paymentReservation}
                    reservationError={paymentReservationError}
                    reservationLoading={paymentReservationLoading}
                    seatsUnlimited={isMembershipRegistration}
                  />
                  {paymentRequiredForCurrentSeat ? (
                    <RegistrationPaymentPanel
                      amountDue={getEventPaymentTotal(event)}
                      config={squareConfig}
                      disabled={submitting || Boolean(confirmation)}
                      error={squareError}
                      onCardReady={setSquareCard}
                      onEnsureReservation={ensurePaymentReservation}
                      onWalletTokenReady={setSquareWalletToken}
                      onlinePaymentRequired={paymentRequiredForCurrentSeat}
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
                  {/* "Please fix the highlighted fields" was rendered at the
                      top of the form only. On a membership signup that is four
                      questions, a terms panel and a card form above the
                      button, so the one message telling you why nothing
                      happened was off screen at the moment you needed it. */}
                  {formError ? <p className="form-error">{formError}</p> : null}
                  <button
                    className="button-link button-reset"
                    disabled={submitting
                      || Boolean(registrationUnavailable)
                      || paymentReservationExpired
                      || (paymentRequiredForCurrentSeat && (!squareCard && !squareWalletToken || Boolean(squareError && !squareWalletToken)))
                      || (requiresReactivationTerms && !reactivationTermsAccepted)
                      || (requiresMembershipTerms && !membershipTermsAccepted)}
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

// Never an empty panel. An error with no usable message used to set formError
// to undefined, which renders as nothing at all: the submit visibly failed and
// the page said why in zero words.
export function describeSubmitError(error) {
  const message = String(error?.message || '').trim();
  // Square attaches the specifics here; its `message` is often the generic
  // line on its own.
  const detail = Array.isArray(error?.errors)
    ? error.errors.map((item) => item?.detail || item?.message).filter(Boolean).join(' ')
    : '';

  if (message && detail && !message.includes(detail)) {
    return `${message} (${detail})`;
  }

  return message
    || detail
    || 'Something went wrong completing this registration. Nothing has been charged. Please try again, and tell an administrator if it keeps happening.';
}

function EventSummary({ event }) {
  // A membership signup has no date, no time, nowhere it happens and no seat
  // limit. Rendering those rows anyway produced "Date TBD", "12:00 a.m. -
  // 12:00 a.m." and "To be announced" on the one page a prospective member
  // sees before paying - three answers to questions nobody asked, which read
  // as a half-configured event rather than a deliberate omission.
  const isMembership = isMembershipEvent(event);
  const cost = event.isPaid
    ? `${formatCurrency(getEventPaymentTotal(event))} total`
    : 'No Charge';
  const paymentBreakdown = event.isPaid && Number(event.serviceFee || 0) > 0
    ? `${formatCurrency(getEventCostOn(event))} + ${formatCurrency(event.serviceFee || 0)} service fee`
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
        {event.eventType !== 'Challenges' && !isMembership ? (
          <>
            <div>
              <dt>Date</dt>
              <dd>{formatEventDate(event.date)}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
            </div>
          </>
        ) : null}
        {registrationStartDate || registrationEndDate ? (
          <div>
            <dt>Registration Open/Closes</dt>
            <dd>{formatRegistrationDateRange(event)}</dd>
          </div>
        ) : null}
        {!isMembership ? (
          <div>
            <dt>Location</dt>
            <dd>{event.location || 'To be announced'}</dd>
          </div>
        ) : null}
        <div>
          <dt>Cost</dt>
          <dd>
            {cost}
            {paymentBreakdown ? <span className="form-help">{paymentBreakdown}</span> : null}
          </dd>
        </div>
        {!isMembership ? (
          <div>
            <dt>Capacity</dt>
            <dd>{event.capacityUnlimited ? 'Unlimited' : event.capacity || 'To be announced'}</dd>
          </div>
        ) : null}
      </dl>
    </aside>
  );
}

// Exported for tests: the completion card is where the password offer is
// actually acted on, and the page around it needs the whole registration
// flow standing up before it can be rendered.
export function RegistrationCompletion({
  closeMessage,
  confirmation,
  event,
  passwordSetupError,
  passwordSetupPending,
  onReturn,
  onSetUpPassword,
  returnLabel = 'Return To List'
}) {
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
        {event.eventType !== 'Challenges' && !isMembershipEvent(event) ? (
          <>
            <div>
              <dt>Date</dt>
              <dd>{formatEventDate(event.date)}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
            </div>
          </>
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
        {onSetUpPassword ? (
          <button
            className="button-link"
            disabled={passwordSetupPending}
            type="button"
            onClick={onSetUpPassword}
          >
            {passwordSetupPending ? 'Opening...' : 'Create Your Password'}
          </button>
        ) : null}
        {onReturn ? (
          <button className="button-link button-reset" type="button" onClick={onReturn}>
            {returnLabel}
          </button>
        ) : null}
      </div>
      {passwordSetupError ? <p className="form-error">{passwordSetupError}</p> : null}
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

function createRegistrationAttemptKey() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validateForm({
  email,
  firstName,
  isMembershipRegistration = false,
  lastName,
  membershipPhoneType = '',
  membershipRenewalType = '',
  membershipSkills = '',
  membershipVeteran = '',
  phone
}) {
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

  if (isMembershipRegistration) {
    Object.assign(errors, getMembershipAnswerErrors({
      phoneType: membershipPhoneType,
      renewalType: membershipRenewalType,
      skills: membershipSkills,
      veteran: membershipVeteran
    }));
  }

  if (phone.replace(/\D/g, '').length < 10) {
    errors.phone = 'Phone number is required.';
  }

  return errors;
}

export default RegisterPage;
