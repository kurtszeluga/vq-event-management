import { createHash, createSign } from 'node:crypto';
import { cleanText, normalizeEmail } from './registration-verification.js';

const FIREBASE_CUSTOM_TOKEN_AUDIENCE = 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit';
const FIREBASE_CUSTOM_TOKEN_TTL_SECONDS = 60 * 60;

export {
  generateEmailCode,
  getTimestampMillis,
  hashVerificationSecret,
  verificationSecretsMatch,
  cleanText,
  normalizeEmail
} from './registration-verification.js';

export const ACCOUNT_RECOVERY_CODE_EXPIRATION_MS = 10 * 60 * 1000;
export const ACCOUNT_RECOVERY_CODE_MAX_ATTEMPTS = 5;
export const ACCOUNT_RECOVERY_CODE_RESEND_DELAY_MS = 60 * 1000;
export const ACCOUNT_RECOVERY_CODE_SEND_WINDOW_MS = 60 * 60 * 1000;
export const ACCOUNT_RECOVERY_CODE_MAX_SENDS_PER_WINDOW = 5;

export function normalizePhoneDigits(value) {
  return String(value || '').replace(/\D/g, '').slice(0, 10);
}

export function formatPhoneForStorage(value) {
  const digits = normalizePhoneDigits(value);

  if (digits.length !== 10) {
    return '';
  }

  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// A person recovering their account may only remember one of email/phone,
// so the same field accepts either - detected by shape rather than asked
// for separately, which is the whole point of collapsing the two flows.
export function classifyRecoveryIdentifier(rawValue) {
  const trimmed = cleanText(rawValue);

  if (trimmed.includes('@')) {
    return { type: 'email', value: normalizeEmail(trimmed) };
  }

  const digits = normalizePhoneDigits(trimmed);

  if (digits.length === 10) {
    return { type: 'phone', value: digits };
  }

  return { type: null, value: '' };
}

export function buildAccountRecoveryDocumentId(type, value) {
  return createHash('sha256')
    .update(`${cleanText(type)}:${cleanText(value)}`)
    .digest('hex');
}

// Hand-signed rather than firebase-admin/auth's getAuth().createCustomToken()
// - that subpath pulls in dependencies this project's Vercel functions have
// never needed (see firebase-token.js, which verifies ID tokens the same
// way, with node:crypto only). A Firebase custom token is just a JWT in a
// documented shape, signed with the service account's own private key.
export function createFirebaseCustomToken(uid) {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  const { client_email: clientEmail, private_key: privateKey } = JSON.parse(serviceAccountJson);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    aud: FIREBASE_CUSTOM_TOKEN_AUDIENCE,
    exp: nowSeconds + FIREBASE_CUSTOM_TOKEN_TTL_SECONDS,
    iat: nowSeconds,
    iss: clientEmail,
    sub: clientEmail,
    uid
  };
  const unsignedToken = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = createSign('RSA-SHA256').update(unsignedToken).sign(privateKey).toString('base64url');

  return `${unsignedToken}.${signature}`;
}

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}
