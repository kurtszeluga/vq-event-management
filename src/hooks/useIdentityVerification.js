import { useCallback, useEffect, useState } from 'react';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase.js';
import {
  lookupRegistrationEmail,
  startRegistrationEmailVerification,
  verifyRegistrationEmailCode
} from '../services/registrationService.js';
import { getProfileExists } from '../utils/registrationEligibility.js';

// Owns proving who the registrant is: email lookup, password sign-in, and
// the emailed-code fallback. Registrant form state is not owned here -
// applyProfile/reset/setFieldErrors are passed in from useRegistrantForm so
// a successful lookup or verification can populate/clear it.
//
// runEmailLookup also touches registration-submission and payment-reservation
// state that belongs to RegisterPage: a new lookup must clear any prior
// confirmation and in-progress payment hold, and a lookup failure must
// surface through the same form-level error RegisterPage already shows.
// Rather than absorb that state into this hook, the caller supplies
// setFormError directly and onBeforeLookup for the rest, keeping this hook's
// own state to only what it declares.
export function useIdentityVerification({
  applyProfile,
  currentUser,
  eventId,
  onBeforeLookup,
  reset,
  setFieldErrors,
  setFormError,
  userProfile
}) {
  const [accountVerified, setAccountVerified] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [email, setEmail] = useState('');
  const [emailVerificationChallengeId, setEmailVerificationChallengeId] = useState('');
  const [emailVerificationCode, setEmailVerificationCode] = useState('');
  const [emailVerificationError, setEmailVerificationError] = useState('');
  const [emailVerificationMessage, setEmailVerificationMessage] = useState('');
  const [emailVerificationSending, setEmailVerificationSending] = useState(false);
  const [emailVerificationVerifying, setEmailVerificationVerifying] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  // Minted by the code-verification endpoint so the member can be signed in
  // later to set a password. Held rather than used: signing in here would
  // move the gates the rest of the registration is standing on.
  const [passwordSetupToken, setPasswordSetupToken] = useState('');
  const [lookup, setLookup] = useState(null);
  // A first wrong password stays on the password panel; only a second one
  // hands the registrant over to the emailed code.
  const [passwordAttempts, setPasswordAttempts] = useState(0);
  const [lookupComplete, setLookupComplete] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [reactivateProfile, setReactivateProfile] = useState(false);
  const [reactivationTermsAccepted, setReactivationTermsAccepted] = useState(false);
  const [registrationVerificationToken, setRegistrationVerificationToken] = useState('');
  const [showEmailVerification, setShowEmailVerification] = useState(false);

  const runEmailLookup = useCallback(async (emailValue, options = {}) => {
    const normalizedEmail = String(emailValue || '').trim().toLowerCase();
    const alreadyVerified = Boolean(options.alreadyVerified);

    setFieldErrors({});
    setAccountVerified(alreadyVerified);
    setAuthError('');
    setAuthPassword('');
    setFormError('');
    onBeforeLookup();
    setEmailVerificationChallengeId('');
    setEmailVerificationCode('');
    setEmailVerificationError('');
    setEmailVerificationMessage('');
    setEmailVerified(false);
    setRegistrationVerificationToken('');
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
        applyProfile(result.profile);
        setAccountVerified(Boolean(alreadyVerified && result.verified));
        setReactivateProfile(Boolean(alreadyVerified && result.profile.status !== 'Active'));
        setReactivationTermsAccepted(false);
        setShowEmailVerification(false);
      } else if (result.status === 'email-verification-required') {
        reset();
        setShowEmailVerification(true);
      } else {
        reset();
        setShowEmailVerification(false);
      }
    } catch (error) {
      setFormError(error.message);
    } finally {
      setLookupLoading(false);
    }
  }, [applyProfile, eventId, onBeforeLookup, reset, setFieldErrors, setFormError]);

  useEffect(() => {
    if (!eventId || !currentUser || !userProfile?.email || lookupComplete || lookupLoading) {
      return;
    }

    runEmailLookup(userProfile.email, { alreadyVerified: true });
  }, [currentUser, eventId, lookupComplete, lookupLoading, runEmailLookup, userProfile]);

  const handleEmailLookup = useCallback(async () => {
    await runEmailLookup(email);
  }, [email, runEmailLookup]);

  const handleEmailChange = useCallback((value) => {
    setEmail(value);
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
    setPasswordAttempts(0);
    setRegistrationVerificationToken('');
    setShowEmailVerification(false);
    setReactivationTermsAccepted(false);
    reset();
  }, [reset]);

  const handlePasswordSignIn = useCallback(async () => {
    if (!getProfileExists(lookup)) {
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
      const attempts = passwordAttempts + 1;

      setPasswordAttempts(attempts);
      setAccountVerified(false);
      setAuthPassword('');

      // Switching to the code panel on the first failure gives a mistyped
      // password no second chance. Stay put once; the panel's own "Email Me A
      // Verification Code" button is still there for anyone who wants it
      // sooner.
      if (attempts > 1) {
        setEmailVerificationCode('');
        setEmailVerificationError('We could not sign you in. You can continue with a code sent to your email address.');
        setShowEmailVerification(true);
      } else {
        setAuthError('That password is not correct. Please try again or use the Email Me A Verification Code option below.');
      }
    } finally {
      setAuthSubmitting(false);
    }
  }, [authPassword, email, lookup, passwordAttempts, runEmailLookup]);

  const handleStartEmailVerification = useCallback(async () => {
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
  }, [email, eventId]);

  const handleVerifyEmailCode = useCallback(async () => {
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
      setPasswordSetupToken(result.passwordSetupToken || '');
      setEmailVerificationError('');
      setEmailVerificationMessage('Email verified. You can continue with registration.');
      setShowEmailVerification(false);

      if (result.profile) {
        applyProfile(result.profile);
        setReactivateProfile(result.profile.status !== 'Active');
      } else {
        reset();
        setReactivateProfile(false);
      }

      setReactivationTermsAccepted(false);
    } catch (error) {
      setEmailVerified(false);
      setRegistrationVerificationToken('');
      setPasswordSetupToken('');
      setEmailVerificationError(error.message);
    } finally {
      setEmailVerificationVerifying(false);
    }
  }, [applyProfile, email, emailVerificationChallengeId, emailVerificationCode, eventId, reset]);

  return {
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
    runEmailLookup,
    setAuthError,
    setAuthPassword,
    setEmailVerificationCode,
    setEmailVerificationError,
    setReactivationTermsAccepted,
    showEmailVerification
  };
}
