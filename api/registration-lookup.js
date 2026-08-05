import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getRequireMembershipCheck } from './_lib/membership-settings.js';
import { initializeAdminApp } from './_lib/public-event-feed.js';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';
import { ensureAuthUserForProfile } from './_lib/auth-account.js';
import { enforceRateLimit } from './_lib/rate-limit.js';
import {
  EMAIL_CODE_EXPIRATION_MS,
  EMAIL_CODE_MAX_ATTEMPTS,
  EMAIL_CODE_MAX_SENDS_PER_WINDOW,
  EMAIL_CODE_RESEND_DELAY_MS,
  EMAIL_CODE_SEND_WINDOW_MS,
  REGISTRATION_TOKEN_EXPIRATION_MS,
  buildVerificationDocumentId,
  cleanText,
  generateEmailCode,
  generateRegistrationToken,
  getTimestampMillis,
  hashVerificationSecret,
  normalizeEmail,
  verificationSecretsMatch
} from './_lib/registration-verification.js';
import {
  ACCOUNT_RECOVERY_CODE_EXPIRATION_MS,
  ACCOUNT_RECOVERY_CODE_MAX_ATTEMPTS,
  ACCOUNT_RECOVERY_CODE_MAX_SENDS_PER_WINDOW,
  ACCOUNT_RECOVERY_CODE_RESEND_DELAY_MS,
  ACCOUNT_RECOVERY_CODE_SEND_WINDOW_MS,
  buildAccountRecoveryDocumentId,
  classifyRecoveryIdentifier,
  createFirebaseCustomToken,
  formatPhoneForStorage
} from './_lib/account-recovery.js';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const app = initializeAdminApp();
    const db = getFirestore();
    const action = cleanText(request.body?.action) || 'lookup';

    if (action === 'startEmailVerification') {
      await startEmailVerification(request, response, db);
      return;
    }

    if (action === 'verifyEmailCode') {
      await verifyEmailCode(request, response, db, app.options.projectId);
      return;
    }

    if (action === 'startAccountRecovery') {
      await startAccountRecovery(request, response, db);
      return;
    }

    if (action === 'verifyAccountRecoveryCode') {
      await verifyAccountRecoveryCode(request, response, db, app.options.projectId);
      return;
    }

    if (action !== 'lookup') {
      response.status(400).json({ error: 'Unsupported registration verification action.' });
      return;
    }

    const email = normalizeEmail(request.body?.email);
    const eventId = cleanText(request.body?.eventId);

    validateLookupInput(email, eventId);
    await enforceLookupRateLimit(db, request, action, email, eventId);

    const context = await loadLookupContext(db, email, eventId);
    const identity = await getFirebaseIdentity(request, app.options.projectId, email);

    if (identity) {
      validateProfileIdentity(context.profile, identity);
      response.status(200).json(buildVerifiedLookupResponse(context));
      return;
    }

    response.status(200).json(buildPublicLookupResponse(context));
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Registration lookup failed.'
    });
  }
}

async function startEmailVerification(request, response, db) {
  const email = normalizeEmail(request.body?.email);
  const eventId = cleanText(request.body?.eventId);

  validateLookupInput(email, eventId);
  await enforceLookupRateLimit(db, request, 'startEmailVerification', email, eventId);

  const context = await loadLookupContext(db, email, eventId);

  if (!context.profile && !context.allowNonMemberRegistration) {
    throw httpError(
      403,
      'We could not find a Guild membership record for this email address. Guild membership is required to register. Please contact an administrator for assistance.'
    );
  }

  const challengeId = buildVerificationDocumentId(email, eventId);
  const challengeRef = db.collection('registrationVerifications').doc(challengeId);
  const existingSnap = await challengeRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : {};
  const now = Date.now();
  const lastSentAt = getTimestampMillis(existing.lastSentAt);
  const existingWindowStart = getTimestampMillis(existing.sendWindowStartedAt);
  const inCurrentWindow = existingWindowStart && now - existingWindowStart < EMAIL_CODE_SEND_WINDOW_MS;
  const sendCount = inCurrentWindow ? Number(existing.sendCount || 0) : 0;

  if (lastSentAt && now - lastSentAt < EMAIL_CODE_RESEND_DELAY_MS) {
    throw httpError(429, 'A verification code was sent recently. Please wait one minute before requesting another code.');
  }

  if (sendCount >= EMAIL_CODE_MAX_SENDS_PER_WINDOW) {
    throw httpError(429, 'Too many verification codes have been requested. Please wait and try again later.');
  }

  const code = generateEmailCode();
  const nowTimestamp = Timestamp.fromMillis(now);

  await challengeRef.set({
    attemptCount: 0,
    codeExpiresAt: Timestamp.fromMillis(now + EMAIL_CODE_EXPIRATION_MS),
    codeHash: hashVerificationSecret(challengeId, code),
    consumedAt: null,
    email,
    eventId,
    expiresAt: Timestamp.fromMillis(now + EMAIL_CODE_EXPIRATION_MS),
    lastSentAt: nowTimestamp,
    registrationTokenExpiresAt: null,
    registrationTokenHash: '',
    sendCount: sendCount + 1,
    sendWindowStartedAt: inCurrentWindow
      ? existing.sendWindowStartedAt
      : nowTimestamp,
    updatedAt: nowTimestamp,
    verifiedAt: null
  });

  try {
    await sendVerificationEmail({
      code,
      email,
      eventTitle: context.event?.title || context.event?.eventType || 'event registration'
    });
  } catch (error) {
    await challengeRef.delete().catch(() => {});
    throw error;
  }

  response.status(200).json({
    challengeId,
    message: 'We sent a six-digit verification code to your email address.'
  });
}

async function verifyEmailCode(request, response, db, projectId) {
  const email = normalizeEmail(request.body?.email);
  const eventId = cleanText(request.body?.eventId);
  const challengeId = cleanText(request.body?.challengeId);
  const code = cleanText(request.body?.code);

  validateLookupInput(email, eventId);
  await enforceLookupRateLimit(db, request, 'verifyEmailCode', email, eventId);

  if (!challengeId || !/^\d{6}$/.test(code)) {
    throw httpError(400, 'Enter the six-digit verification code from your email.');
  }

  const expectedChallengeId = buildVerificationDocumentId(email, eventId);

  if (challengeId !== expectedChallengeId) {
    throw httpError(400, 'This verification request is not valid. Request a new code.');
  }

  const challengeRef = db.collection('registrationVerifications').doc(challengeId);
  const challengeSnap = await challengeRef.get();

  if (!challengeSnap.exists) {
    throw httpError(400, 'This verification code is no longer available. Request a new code.');
  }

  const challenge = challengeSnap.data();
  const attemptCount = Number(challenge.attemptCount || 0);

  if (challenge.email !== email || challenge.eventId !== eventId) {
    throw httpError(400, 'This verification request is not valid. Request a new code.');
  }

  if (attemptCount >= EMAIL_CODE_MAX_ATTEMPTS) {
    throw httpError(429, 'Too many incorrect attempts. Request a new verification code.');
  }

  if (getTimestampMillis(challenge.codeExpiresAt) <= Date.now()) {
    throw httpError(400, 'This verification code has expired. Request a new code.');
  }

  if (!verificationSecretsMatch(challenge.codeHash, challengeId, code)) {
    await challengeRef.update({
      attemptCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    });
    throw httpError(400, 'The verification code is incorrect. Please try again.');
  }

  const context = await loadLookupContext(db, email, eventId);
  const registrationToken = generateRegistrationToken();
  const now = Date.now();

  await challengeRef.update({
    attemptCount,
    codeHash: '',
    expiresAt: Timestamp.fromMillis(now + REGISTRATION_TOKEN_EXPIRATION_MS),
    registrationTokenExpiresAt: Timestamp.fromMillis(now + REGISTRATION_TOKEN_EXPIRATION_MS),
    registrationTokenHash: hashVerificationSecret(challengeId, registrationToken),
    updatedAt: FieldValue.serverTimestamp(),
    verifiedAt: FieldValue.serverTimestamp()
  });

  // A member who arrived by code has a profile but often no password, so the
  // registration page offers to set one afterwards. That needs them signed in,
  // which needs a custom token - the same pair of steps account recovery does
  // below, and for the same reason: signing in with a custom token creates the
  // Auth record if it is missing, and one created that way carries only a uid
  // with no email, permanently locking the member out of password sign-in.
  // Completing the record first is what avoids that.
  //
  // Both steps are deliberately non-fatal and the token is deliberately not
  // used here. Registration must not fail because an optional convenience
  // could not be prepared, and the page holds the token until the member
  // actually asks to set a password - signing them in mid-registration would
  // change the gates the rest of the flow is standing on.
  let passwordSetupToken = '';

  if (context.profile) {
    try {
      const profileUserId = context.profile.userId || context.profile.id;
      const account = await ensureAuthUserForProfile(db, projectId, profileUserId);

      if (canSetUpPassword(account)) {
        passwordSetupToken = createFirebaseCustomToken(profileUserId);
      }
    } catch (error) {
      console.error('Could not prepare password setup after code verification', error);
      passwordSetupToken = '';
    }
  }

  response.status(200).json({
    ...buildVerifiedLookupResponse(context),
    challengeId,
    passwordSetupToken,
    registrationToken
  });
}

// The 10 minutes named here must track ACCOUNT_RECOVERY_CODE_EXPIRATION_MS
// below - it's restated in copy because the code's own expiry isn't
// otherwise visible to the person who just requested it.
const ACCOUNT_RECOVERY_GENERIC_MESSAGE = 'If we found an account matching that email or phone number, '
  + 'we sent a verification code to the email address on file. The code expires in 10 minutes.';

async function startAccountRecovery(request, response, db) {
  const identifier = classifyRecoveryIdentifier(request.body?.identifier);

  if (!identifier.type) {
    throw httpError(400, 'Enter your email address or a 10-digit phone number.');
  }

  await enforceRecoveryRateLimit(db, request, 'startAccountRecovery', identifier.value);

  const challengeId = buildAccountRecoveryDocumentId(identifier.type, identifier.value);
  const challengeRef = db.collection('accountRecoveryVerifications').doc(challengeId);
  const existingSnap = await challengeRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : {};
  const now = Date.now();
  const lastSentAt = getTimestampMillis(existing.lastSentAt);
  const existingWindowStart = getTimestampMillis(existing.sendWindowStartedAt);
  const inCurrentWindow = existingWindowStart && now - existingWindowStart < ACCOUNT_RECOVERY_CODE_SEND_WINDOW_MS;
  const sendCount = inCurrentWindow ? Number(existing.sendCount || 0) : 0;

  if (lastSentAt && now - lastSentAt < ACCOUNT_RECOVERY_CODE_RESEND_DELAY_MS) {
    throw httpError(429, 'A verification code was sent recently. Please wait one minute before requesting another code.');
  }

  if (sendCount >= ACCOUNT_RECOVERY_CODE_MAX_SENDS_PER_WINDOW) {
    throw httpError(429, 'Too many verification codes have been requested. Please wait and try again later.');
  }

  // Looked up here (rather than at verify time) so the profile match and
  // whether we actually email/sign anyone in stays fixed to this send - a
  // profile being edited between send and verify can't change what the
  // challenge reveals.
  const profile = identifier.type === 'email'
    ? await findUserProfileByEmail(db, identifier.value)
    : await findUserProfileByPhone(db, identifier.value);
  const code = generateEmailCode();
  const nowTimestamp = Timestamp.fromMillis(now);

  await challengeRef.set({
    attemptCount: 0,
    codeExpiresAt: Timestamp.fromMillis(now + ACCOUNT_RECOVERY_CODE_EXPIRATION_MS),
    codeHash: hashVerificationSecret(challengeId, code),
    consumedAt: null,
    email: profile?.email || '',
    lastSentAt: nowTimestamp,
    profileFound: Boolean(profile),
    profileUserId: profile ? (profile.userId || profile.id) : '',
    sendCount: sendCount + 1,
    sendWindowStartedAt: inCurrentWindow ? existing.sendWindowStartedAt : nowTimestamp,
    updatedAt: nowTimestamp,
    verifiedAt: null
  });

  if (profile?.email) {
    try {
      await sendAccountRecoveryEmail({ code, email: profile.email });
    } catch (error) {
      await challengeRef.delete().catch(() => {});
      throw error;
    }
  }

  response.status(200).json({ challengeId, message: ACCOUNT_RECOVERY_GENERIC_MESSAGE });
}

async function verifyAccountRecoveryCode(request, response, db, projectId) {
  const challengeId = cleanText(request.body?.challengeId);
  const code = cleanText(request.body?.code);

  await enforceRecoveryRateLimit(db, request, 'verifyAccountRecoveryCode', challengeId);

  if (!challengeId || !/^\d{6}$/.test(code)) {
    throw httpError(400, 'Enter the six-digit verification code from your email.');
  }

  const challengeRef = db.collection('accountRecoveryVerifications').doc(challengeId);
  const challengeSnap = await challengeRef.get();

  if (!challengeSnap.exists) {
    throw httpError(400, 'This verification code is no longer available. Request a new code.');
  }

  const challenge = challengeSnap.data();
  const attemptCount = Number(challenge.attemptCount || 0);

  if (attemptCount >= ACCOUNT_RECOVERY_CODE_MAX_ATTEMPTS) {
    throw httpError(429, 'Too many incorrect attempts. Request a new verification code.');
  }

  if (getTimestampMillis(challenge.codeExpiresAt) <= Date.now()) {
    throw httpError(400, 'This verification code has expired. Request a new code.');
  }

  if (!verificationSecretsMatch(challenge.codeHash, challengeId, code)) {
    await challengeRef.update({
      attemptCount: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    });
    throw httpError(400, 'The verification code is incorrect. Please try again.');
  }

  await challengeRef.update({
    codeHash: '',
    updatedAt: FieldValue.serverTimestamp(),
    verifiedAt: FieldValue.serverTimestamp()
  });

  if (!challenge.profileFound || !challenge.profileUserId) {
    throw httpError(400, "We couldn't find an account for that email or phone number.");
  }

  // Complete the Auth record BEFORE minting the token. Signing in with a
  // custom token makes Firebase create the account if it does not exist, and
  // it creates one carrying only the uid - no email - which permanently locks
  // that member out of password sign-in. Doing it here means a member who
  // arrives by code still ends up able to set a password afterwards.
  //
  // Deliberately non-fatal: a member in front of a code prompt should not be
  // refused entry because this could not be tidied up. Worst case they sign in
  // exactly as they did before this existed.
  // True means "do not treat this session as provisional", which is the
  // conservative answer whenever the question cannot be answered: it leaves the
  // member signed in exactly as they were before this existed, rather than
  // signing them out over a check that failed.
  let hasPassword = true;

  try {
    const account = await ensureAuthUserForProfile(db, projectId, challenge.profileUserId);
    hasPassword = !canSetUpPassword(account);
  } catch (error) {
    console.error('Could not complete the Auth record before recovery sign-in', error);
  }

  let customToken;

  try {
    customToken = createFirebaseCustomToken(challenge.profileUserId);
  } catch (error) {
    console.error('Account recovery custom token could not be created', error);
    throw httpError(500, 'Could not sign you in. Please try again.');
  }

  response.status(200).json({ customToken, hasPassword, verified: true });
}

async function enforceRecoveryRateLimit(db, request, action, targetKey) {
  const oneHour = 60 * 60 * 1000;
  const tenMinutes = 10 * 60 * 1000;

  if (action === 'startAccountRecovery') {
    await enforceRateLimit(db, {
      limit: 10,
      message: 'Too many verification code requests. Please wait and try again later.',
      request,
      scope: 'account-recovery-send-ip',
      windowMs: oneHour
    });
    await enforceRateLimit(db, {
      keyParts: [targetKey],
      limit: 5,
      message: 'Too many verification code requests for this email or phone number. Please wait and try again later.',
      scope: 'account-recovery-send-target',
      windowMs: oneHour
    });
    return;
  }

  await enforceRateLimit(db, {
    limit: 40,
    message: 'Too many verification attempts. Please wait and try again later.',
    request,
    scope: 'account-recovery-verify-ip',
    windowMs: tenMinutes
  });
  await enforceRateLimit(db, {
    keyParts: [targetKey],
    limit: 10,
    message: 'Too many verification attempts for this request. Please request a new code later.',
    scope: 'account-recovery-verify-target',
    windowMs: tenMinutes
  });
}

async function findUserProfileByPhone(db, phoneDigits) {
  const formattedPhone = formatPhoneForStorage(phoneDigits);

  if (!formattedPhone) {
    return null;
  }

  // .limit(1): phone is not guaranteed unique across profiles (e.g. a
  // shared household phone). This takes the first match, same tradeoff
  // findUserProfileByEmail makes below.
  const snapshot = await db.collection('users').where('phone', '==', formattedPhone).limit(1).get();

  if (snapshot.empty) {
    return null;
  }

  const docSnapshot = snapshot.docs[0];
  return { id: docSnapshot.id, ...docSnapshot.data() };
}

async function sendAccountRecoveryEmail({ code, email }) {
  if (!process.env.RESEND_API_KEY) {
    throw httpError(500, 'Account recovery email is not configured.');
  }

  const resendResponse = await fetch('https://api.resend.com/emails', {
    body: JSON.stringify({
      from: 'The Village Quilters <no-reply@villagequilters.com>',
      html: `
        <div style="background:#f3eee8;padding:28px 16px;font-family:Arial,sans-serif;color:#1d2927;">
          <div style="max-width:600px;margin:0 auto;background:#fffdfa;border:1px solid #ded5ca;border-radius:8px;overflow:hidden;">
            <div style="background:#225c56;color:#ffffff;padding:22px 26px;">
              <strong style="font-size:20px;">The Village Quilters</strong>
            </div>
            <div style="padding:26px;">
              <h1 style="font-size:22px;margin:0 0 12px;">Account Recovery</h1>
              <p style="line-height:1.55;">Use this code to verify your identity and retrieve the email address on your account.</p>
              <p style="font-size:30px;font-weight:800;letter-spacing:6px;margin:24px 0;color:#8a2f1f;">${code}</p>
              <p style="line-height:1.55;">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
            </div>
            <div style="background:#225c56;color:#ffffff;padding:14px 26px;font-size:13px;">
              The Village Quilters, Inc.
            </div>
          </div>
        </div>
      `,
      subject: 'Your Village Quilters account recovery code',
      text: `Your Village Quilters account recovery code is ${code}. It expires in 10 minutes.`,
      to: email
    }),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });

  if (!resendResponse.ok) {
    const errorBody = await resendResponse.text();
    console.error('Account recovery email failed', errorBody);
    throw httpError(502, 'Verification email could not be sent. Please try again.');
  }
}

async function enforceLookupRateLimit(db, request, action, email, eventId) {
  const oneHour = 60 * 60 * 1000;
  const tenMinutes = 10 * 60 * 1000;

  if (action === 'startEmailVerification') {
    await enforceRateLimit(db, {
      limit: 10,
      message: 'Too many verification code requests. Please wait and try again later.',
      request,
      scope: 'registration-email-code-send-ip',
      windowMs: oneHour
    });
    await enforceRateLimit(db, {
      keyParts: [email, eventId],
      limit: 5,
      message: 'Too many verification code requests for this email and event. Please wait and try again later.',
      scope: 'registration-email-code-send-target',
      windowMs: oneHour
    });
    return;
  }

  if (action === 'verifyEmailCode') {
    await enforceRateLimit(db, {
      limit: 40,
      message: 'Too many verification attempts. Please wait and try again later.',
      request,
      scope: 'registration-email-code-verify-ip',
      windowMs: tenMinutes
    });
    await enforceRateLimit(db, {
      keyParts: [email, eventId],
      limit: 10,
      message: 'Too many verification attempts for this registration. Please request a new code later.',
      scope: 'registration-email-code-verify-target',
      windowMs: tenMinutes
    });
    return;
  }

  await enforceRateLimit(db, {
    limit: 80,
    message: 'Too many registration lookup requests. Please wait and try again later.',
    request,
    scope: 'registration-lookup-ip',
    windowMs: tenMinutes
  });
  await enforceRateLimit(db, {
    keyParts: [email, eventId],
    limit: 20,
    message: 'Too many registration lookup requests for this email and event. Please wait and try again later.',
    scope: 'registration-lookup-target',
    windowMs: tenMinutes
  });
}

// Whether it is worth asking this member to set a password. Two ways the
// answer is no: they already have one, so the question is just confusing; or
// the profile carries no email, in which case ensureAuthUserForProfile bailed
// without touching Identity Platform and a password could not be used to sign
// in even if one were set - see the note at the top of that module.
function canSetUpPassword(account) {
  return account.reason !== 'no-profile-email' && !account.hasPassword;
}

async function loadLookupContext(db, email, eventId) {
  const event = await findEventById(db, eventId);

  if (!event || event.status !== 'Published') {
    throw httpError(404, 'This event is no longer available.');
  }

  const allowNonMemberRegistration = Boolean(event.allowNonMemberRegistration);
  const profile = await findUserProfileByEmail(db, email);
  const hasExistingRegistration = await findActiveRegistration(
    db,
    eventId,
    email,
    profile?.userId || profile?.id || ''
  );
  const membershipStatus = getMembershipStatus(profile);
  const profileStatus = getProfileStatus(profile);
  const requireMembershipCheck = await getRequireMembershipCheck(db);

  return {
    allowNonMemberRegistration,
    event,
    hasExistingRegistration,
    membershipStatus,
    profile,
    profileStatus,
    requireMembershipCheck
  };
}

export function buildPublicLookupResponse(context) {
  if (!context.profile && !context.allowNonMemberRegistration) {
    return {
      allowNonMemberRegistration: false,
      profileExists: false,
      status: 'membership-not-found',
      verificationRequired: false
    };
  }

  return {
    allowNonMemberRegistration: context.allowNonMemberRegistration,
    profileExists: Boolean(context.profile),
    status: context.profile
      ? 'profile-verification-required'
      : 'email-verification-required',
    verificationRequired: true
  };
}

function buildVerifiedLookupResponse(context) {
  return {
    allowNonMemberRegistration: context.allowNonMemberRegistration,
    hasExistingRegistration: context.hasExistingRegistration,
    membership: context.profile ? serializeMembership(context.profile) : null,
    membershipStatus: context.membershipStatus,
    profile: context.profile
      ? serializeProfile(context.profile, context.profileStatus, context.membershipStatus)
      : null,
    profileExists: Boolean(context.profile),
    status: getVerifiedLookupStatus(context),
    verificationRequired: false,
    verified: true
  };
}

async function getFirebaseIdentity(request, projectId, expectedEmail) {
  const authHeader = request.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ')
    ? authHeader.slice('Bearer '.length)
    : '';

  if (!idToken) {
    return null;
  }

  let decodedToken;

  try {
    decodedToken = await verifyFirebaseIdToken(idToken, projectId);
  } catch {
    throw httpError(401, 'Your sign-in has expired. Please sign in again or request an email verification code.');
  }
  const tokenEmail = normalizeEmail(decodedToken.email);
  const userId = decodedToken.user_id || decodedToken.sub || decodedToken.uid || '';

  if (!tokenEmail || tokenEmail !== expectedEmail || !userId) {
    throw httpError(403, 'The signed-in account does not match this registration email.');
  }

  return { email: tokenEmail, userId };
}

function validateProfileIdentity(profile, identity) {
  if (!profile) {
    return;
  }

  const profileUserId = profile.userId || profile.id;

  if (profileUserId !== identity.userId) {
    throw httpError(403, 'The signed-in account is not linked to this member profile.');
  }
}

async function sendVerificationEmail({ code, email, eventTitle }) {
  if (!process.env.RESEND_API_KEY) {
    throw httpError(500, 'Registration verification email is not configured.');
  }

  const safeEventTitle = escapeHtml(eventTitle);
  const resendResponse = await fetch('https://api.resend.com/emails', {
    body: JSON.stringify({
      from: 'The Village Quilters <no-reply@villagequilters.com>',
      html: `
        <div style="background:#f3eee8;padding:28px 16px;font-family:Arial,sans-serif;color:#1d2927;">
          <div style="max-width:600px;margin:0 auto;background:#fffdfa;border:1px solid #ded5ca;border-radius:8px;overflow:hidden;">
            <div style="background:#225c56;color:#ffffff;padding:22px 26px;">
              <strong style="font-size:20px;">The Village Quilters</strong>
            </div>
            <div style="padding:26px;">
              <h1 style="font-size:22px;margin:0 0 12px;">Registration Verification</h1>
              <p style="line-height:1.55;">Use this code to continue registering for <strong>${safeEventTitle}</strong>.</p>
              <p style="font-size:30px;font-weight:800;letter-spacing:6px;margin:24px 0;color:#8a2f1f;">${code}</p>
              <p style="line-height:1.55;">This code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
            </div>
            <div style="background:#225c56;color:#ffffff;padding:14px 26px;font-size:13px;">
              The Village Quilters, Inc.
            </div>
          </div>
        </div>
      `,
      subject: 'Your Village Quilters registration verification code',
      text: `Your Village Quilters registration verification code is ${code}. It expires in 10 minutes.`,
      to: email
    }),
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    method: 'POST'
  });

  if (!resendResponse.ok) {
    const errorBody = await resendResponse.text();
    console.error('Registration verification email failed', errorBody);
    throw httpError(502, 'Verification email could not be sent. Please try again.');
  }
}

async function findEventById(db, eventId) {
  const eventSnap = await db.collection('events').doc(eventId).get();
  return eventSnap.exists ? { id: eventSnap.id, ...eventSnap.data() } : null;
}

async function findUserProfileByEmail(db, email) {
  const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();

  if (snapshot.empty) {
    return null;
  }

  const docSnapshot = snapshot.docs[0];
  return { id: docSnapshot.id, ...docSnapshot.data() };
}

async function findActiveRegistration(db, eventId, email, userId) {
  const snapshot = await db
    .collection('registrations')
    .where('eventId', '==', eventId)
    .get();

  return snapshot.docs.some((docSnapshot) => {
    const registration = docSnapshot.data();

    if (!['Pending Payment', 'Registered', 'Waitlisted'].includes(registration.status)) {
      return false;
    }

    return normalizeEmail(registration.email) === email
      || Boolean(userId && registration.userId === userId);
  });
}

export function getVerifiedLookupStatus({
  allowNonMemberRegistration,
  hasExistingRegistration,
  membershipStatus,
  profile,
  profileStatus,
  requireMembershipCheck = true
}) {
  if (hasExistingRegistration) {
    return 'already-registered';
  }

  if (profile && profileStatus === 'Active' && membershipStatus === 'Active') {
    return 'profile-active';
  }

  if (profile && profileStatus !== 'Active' && membershipStatus === 'Active') {
    return 'profile-reactivation-available';
  }

  if (profile && membershipStatus !== 'Active' && !allowNonMemberRegistration && requireMembershipCheck) {
    return 'profile-membership-blocked';
  }

  if (profile && membershipStatus !== 'Active' && (allowNonMemberRegistration || !requireMembershipCheck)) {
    return profileStatus === 'Active' ? 'profile-active' : 'profile-reactivation-available';
  }

  if (!profile && allowNonMemberRegistration) {
    return 'non-member-registration-allowed';
  }

  return 'membership-not-found';
}

function getMembershipStatus(profile) {
  return profile?.membershipStatus || 'Unknown';
}

function getProfileStatus(profile) {
  if (!profile) {
    return '';
  }

  if (profile.archivedBy || profile.archivedDate || profile.status === 'Archived') {
    return 'Archived';
  }

  return profile.status || 'Unknown';
}

function serializeProfile(profile, profileStatus, membershipStatus) {
  return {
    billingAddress: {
      city: profile.billingAddress?.city || '',
      country: profile.billingAddress?.country || 'United States',
      postalCode: profile.billingAddress?.postalCode || '',
      state: profile.billingAddress?.state || '',
      street: profile.billingAddress?.street || ''
    },
    email: profile.email || '',
    membershipStatus,
    name: profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' '),
    phone: profile.phone || '',
    status: profileStatus,
    userId: profile.userId || profile.id
  };
}

function serializeMembership(profile) {
  return {
    matchedBy: profile.membershipMatchedBy || 'profile',
    memberId: profile.membershipMemberId || profile.userId || profile.id || '',
    name: profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' '),
    status: profile.membershipStatus || 'Unknown'
  };
}

function validateLookupInput(email, eventId) {
  if (!email || !email.includes('@')) {
    throw httpError(400, 'Enter a valid email address.');
  }

  if (!eventId) {
    throw httpError(400, 'Select an event before registering.');
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
