import { createHash } from 'node:crypto';
import { cleanText, normalizeEmail } from './registration-verification.js';

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
