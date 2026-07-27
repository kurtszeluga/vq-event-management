import { FieldValue, getFirestore, Timestamp } from 'firebase-admin/firestore';
import { initializeAdminApp } from './_lib/public-event-feed.js';
import { enforceRateLimit } from './_lib/rate-limit.js';
import {
  PHONE_CODE_EXPIRATION_MS,
  PHONE_CODE_MAX_ATTEMPTS,
  PHONE_CODE_MAX_SENDS_PER_WINDOW,
  PHONE_CODE_RESEND_DELAY_MS,
  PHONE_CODE_SEND_WINDOW_MS,
  buildAccountRecoveryDocumentId,
  cleanText,
  formatPhoneForStorage,
  generateEmailCode,
  getTimestampMillis,
  hashVerificationSecret,
  normalizePhoneDigits,
  verificationSecretsMatch
} from './_lib/account-recovery.js';

const GENERIC_START_MESSAGE = 'If we found an account matching that phone number, '
  + 'we sent a verification code to the email address on file.';

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    initializeAdminApp();
    const db = getFirestore();
    const action = cleanText(request.body?.action);

    if (action === 'startPhoneRecovery') {
      await startPhoneRecovery(request, response, db);
      return;
    }

    if (action === 'verifyPhoneRecoveryCode') {
      await verifyPhoneRecoveryCode(request, response, db);
      return;
    }

    response.status(400).json({ error: 'Unsupported account recovery action.' });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Account recovery request failed.'
    });
  }
}

async function startPhoneRecovery(request, response, db) {
  const phoneDigits = normalizePhoneDigits(request.body?.phone);

  if (phoneDigits.length !== 10) {
    throw httpError(400, 'Enter a valid 10-digit phone number.');
  }

  await enforceRecoveryRateLimit(db, request, 'startPhoneRecovery', phoneDigits);

  const challengeId = buildAccountRecoveryDocumentId(phoneDigits);
  const challengeRef = db.collection('accountRecoveryVerifications').doc(challengeId);
  const existingSnap = await challengeRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : {};
  const now = Date.now();
  const lastSentAt = getTimestampMillis(existing.lastSentAt);
  const existingWindowStart = getTimestampMillis(existing.sendWindowStartedAt);
  const inCurrentWindow = existingWindowStart && now - existingWindowStart < PHONE_CODE_SEND_WINDOW_MS;
  const sendCount = inCurrentWindow ? Number(existing.sendCount || 0) : 0;

  if (lastSentAt && now - lastSentAt < PHONE_CODE_RESEND_DELAY_MS) {
    throw httpError(429, 'A verification code was sent recently. Please wait one minute before requesting another code.');
  }

  if (sendCount >= PHONE_CODE_MAX_SENDS_PER_WINDOW) {
    throw httpError(429, 'Too many verification codes have been requested. Please wait and try again later.');
  }

  // Looked up here (rather than at verify time) so the profile match and
  // whether we actually email anyone stays fixed to this send - a profile
  // being edited between send and verify can't change what the challenge
  // reveals.
  const profile = await findUserProfileByPhone(db, phoneDigits);
  const code = generateEmailCode();
  const nowTimestamp = Timestamp.fromMillis(now);

  await challengeRef.set({
    attemptCount: 0,
    codeExpiresAt: Timestamp.fromMillis(now + PHONE_CODE_EXPIRATION_MS),
    codeHash: hashVerificationSecret(challengeId, code),
    consumedAt: null,
    email: profile?.email || '',
    lastSentAt: nowTimestamp,
    phoneDigits,
    profileFound: Boolean(profile),
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

  response.status(200).json({ challengeId, message: GENERIC_START_MESSAGE });
}

async function verifyPhoneRecoveryCode(request, response, db) {
  const challengeId = cleanText(request.body?.challengeId);
  const code = cleanText(request.body?.code);

  await enforceRecoveryRateLimit(db, request, 'verifyPhoneRecoveryCode', challengeId);

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

  if (attemptCount >= PHONE_CODE_MAX_ATTEMPTS) {
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

  if (!challenge.profileFound || !challenge.email) {
    throw httpError(400, "We couldn't find an account for that phone number.");
  }

  response.status(200).json({ email: challenge.email, verified: true });
}

async function enforceRecoveryRateLimit(db, request, action, targetKey) {
  const oneHour = 60 * 60 * 1000;
  const tenMinutes = 10 * 60 * 1000;

  if (action === 'startPhoneRecovery') {
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
      message: 'Too many verification code requests for this phone number. Please wait and try again later.',
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
  // findUserProfileByEmail makes in registration-lookup.js.
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

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
