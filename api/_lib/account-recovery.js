import { createHash } from 'node:crypto';
import { cleanText } from './registration-verification.js';

export {
  generateEmailCode,
  getTimestampMillis,
  hashVerificationSecret,
  verificationSecretsMatch,
  cleanText
} from './registration-verification.js';

export const PHONE_CODE_EXPIRATION_MS = 10 * 60 * 1000;
export const PHONE_CODE_MAX_ATTEMPTS = 5;
export const PHONE_CODE_RESEND_DELAY_MS = 60 * 1000;
export const PHONE_CODE_SEND_WINDOW_MS = 60 * 60 * 1000;
export const PHONE_CODE_MAX_SENDS_PER_WINDOW = 5;

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

export function buildAccountRecoveryDocumentId(phoneDigits) {
  return createHash('sha256')
    .update(`phone:${cleanText(phoneDigits)}`)
    .digest('hex');
}
