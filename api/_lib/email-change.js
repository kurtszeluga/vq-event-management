import { createHash } from 'node:crypto';
import {
  EMAIL_CODE_MAX_SENDS_PER_WINDOW,
  EMAIL_CODE_RESEND_DELAY_MS,
  EMAIL_CODE_SEND_WINDOW_MS,
  cleanText,
  getTimestampMillis,
  normalizeEmail
} from './registration-verification.js';

// A member changing their own email address.
//
// The field was read-only on ProfilePage with "Email changes are handled
// separately", and separately meant asking an admin. The Firestore rules have
// always allowed a member to write `email` on their own profile - the lock was
// never about permission. It is that the address a member SIGNS IN with lives
// in the Firebase Auth record, not in `users/{uid}.email`, so a profile-only
// edit splits the two: they would still sign in with the old address while
// every notification went to the new one, and nothing would ever reconcile it.
//
// Hence the code. A mistyped address is not a cosmetic mistake here - it is
// the member signing in with an address they cannot receive mail at, so
// password reset goes nowhere and only an admin repairing the Auth record gets
// them back in. Verifying the new address before switching makes a typo fail
// harmlessly: no code arrives, and nothing changes.

// Keyed on the member, not on the address. Requesting a code for a second
// address therefore replaces the first rather than leaving two live
// challenges, and the confirm step re-checks the stored address so the
// replacement cannot be used to confirm the address it replaced.
export function buildEmailChangeChallengeId(uid) {
  return createHash('sha256').update(`email-change|${cleanText(uid)}`).digest('hex');
}

export function validateEmailChange({ currentEmail, newEmail }) {
  const normalized = normalizeEmail(newEmail);

  if (!normalized) {
    return { error: 'Enter the new email address.', ok: false };
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return { error: 'Enter a valid email address.', ok: false };
  }

  if (normalized.length > 254) {
    return { error: 'That email address is too long.', ok: false };
  }

  if (normalized === normalizeEmail(currentEmail)) {
    return { error: 'That is already the email address on this account.', ok: false };
  }

  return { email: normalized, ok: true };
}

// The resend throttle, lifted out of the request handler so it can be tested
// without a Firestore. Same shape as the registration code flow: a minimum gap
// between sends, and a cap per rolling window.
export function getEmailCodeSendDecision({ challenge = {}, now = Date.now() }) {
  const lastSentAt = getTimestampMillis(challenge.lastSentAt);
  const windowStartedAt = getTimestampMillis(challenge.sendWindowStartedAt);
  const inCurrentWindow = Boolean(windowStartedAt)
    && now - windowStartedAt < EMAIL_CODE_SEND_WINDOW_MS;
  const sendCount = inCurrentWindow ? Number(challenge.sendCount || 0) : 0;

  if (lastSentAt && now - lastSentAt < EMAIL_CODE_RESEND_DELAY_MS) {
    return {
      allowed: false,
      error: 'A code was sent recently. Please wait one minute before requesting another.',
      statusCode: 429
    };
  }

  if (sendCount >= EMAIL_CODE_MAX_SENDS_PER_WINDOW) {
    return {
      allowed: false,
      error: 'Too many codes have been requested. Please wait and try again later.',
      statusCode: 429
    };
  }

  return { allowed: true, inCurrentWindow, sendCount: sendCount + 1 };
}

export function buildEmailChangeCodeEmail({ code }) {
  return {
    html: wrapEmail({
      body: `
        <p style="line-height:1.55;">Use this code to confirm this address on your
          Village Quilters account.</p>
        <p style="font-size:30px;font-weight:800;letter-spacing:6px;margin:24px 0;color:#8a2f1f;">${escapeHtml(code)}</p>
        <p style="line-height:1.55;">This code expires in 10 minutes. Your email address
          will not change until you enter it.</p>
        <p style="line-height:1.55;">If you did not ask to change your email address, you
          can ignore this message - nothing has changed.</p>
      `,
      heading: 'Confirm Your New Email Address'
    }),
    subject: 'Confirm your new Village Quilters email address',
    text: `Your Village Quilters email confirmation code is ${code}. It expires in 10 `
      + 'minutes. Your email address will not change until you enter it.'
  };
}

// Sent to the address being left behind. The point is not courtesy: it is the
// only signal a member gets if somebody with access to a live session moves
// the account somewhere they control.
export function buildEmailChangedNotice({ newEmail }) {
  return {
    html: wrapEmail({
      body: `
        <p style="line-height:1.55;">The email address on your Village Quilters account
          was just changed to <strong>${escapeHtml(newEmail)}</strong>.</p>
        <p style="line-height:1.55;">Sign in with the new address from now on. This old
          address will no longer work.</p>
        <p style="line-height:1.55;"><strong>If you did not do this</strong>, contact a
          Guild administrator straight away - whoever made the change can now sign in to
          your account.</p>
      `,
      heading: 'Your Email Address Was Changed'
    }),
    subject: 'Your Village Quilters email address was changed',
    text: 'The email address on your Village Quilters account was just changed to '
      + `${newEmail}. Sign in with the new address from now on. If you did not do this, `
      + 'contact a Guild administrator straight away.'
  };
}

function wrapEmail({ body, heading }) {
  return `
    <div style="background:#f3eee8;padding:28px 16px;font-family:Arial,sans-serif;color:#1d2927;">
      <div style="max-width:600px;margin:0 auto;background:#fffdfa;border:1px solid #ded5ca;border-radius:8px;overflow:hidden;">
        <div style="background:#225c56;color:#ffffff;padding:22px 26px;">
          <strong style="font-size:20px;">The Village Quilters</strong>
        </div>
        <div style="padding:26px;">
          <h1 style="font-size:22px;margin:0 0 12px;">${escapeHtml(heading)}</h1>
          ${body}
        </div>
        <div style="background:#225c56;color:#ffffff;padding:14px 26px;font-size:13px;">
          The Village Quilters, Inc.
        </div>
      </div>
    </div>
  `;
}

function escapeHtml(value) {
  return cleanText(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
