import {
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual
} from 'node:crypto';

export const EMAIL_CODE_EXPIRATION_MS = 10 * 60 * 1000;
export const EMAIL_CODE_MAX_ATTEMPTS = 5;
export const EMAIL_CODE_RESEND_DELAY_MS = 60 * 1000;
export const EMAIL_CODE_SEND_WINDOW_MS = 60 * 60 * 1000;
export const EMAIL_CODE_MAX_SENDS_PER_WINDOW = 5;
export const REGISTRATION_TOKEN_EXPIRATION_MS = 20 * 60 * 1000;

export function buildVerificationDocumentId(email, eventId) {
  return createHash('sha256')
    .update(`${normalizeEmail(email)}|${cleanText(eventId)}`)
    .digest('hex');
}

export function generateEmailCode() {
  return String(randomInt(100000, 1000000));
}

export function generateRegistrationToken() {
  return randomBytes(32).toString('base64url');
}

export function hashVerificationSecret(challengeId, secret) {
  return createHash('sha256')
    .update(`${cleanText(challengeId)}:${cleanText(secret)}`)
    .digest('hex');
}

export function verificationSecretsMatch(expectedHash, challengeId, secret) {
  const expected = Buffer.from(cleanText(expectedHash), 'hex');
  const actual = Buffer.from(hashVerificationSecret(challengeId, secret), 'hex');

  return expected.length > 0
    && expected.length === actual.length
    && timingSafeEqual(expected, actual);
}

export function getTimestampMillis(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

export function cleanText(value) {
  return String(value || '').trim();
}

export function normalizeEmail(value) {
  return cleanText(value).toLowerCase();
}
