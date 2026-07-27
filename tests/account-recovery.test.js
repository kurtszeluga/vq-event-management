import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAccountRecoveryDocumentId,
  formatPhoneForStorage,
  generateEmailCode,
  hashVerificationSecret,
  normalizePhoneDigits,
  verificationSecretsMatch
} from '../api/_lib/account-recovery.js';

test('normalizePhoneDigits strips formatting and caps at 10 digits', () => {
  assert.equal(normalizePhoneDigits('(555) 123-4567'), '5551234567');
  assert.equal(normalizePhoneDigits('555.123.4567 ext 8'), '5551234567');
  assert.equal(normalizePhoneDigits(''), '');
});

test('formatPhoneForStorage matches the format used when saving profiles', () => {
  assert.equal(formatPhoneForStorage('5551234567'), '(555) 123-4567');
  assert.equal(formatPhoneForStorage('555-123-4567'), '(555) 123-4567');
  assert.equal(formatPhoneForStorage('555123'), '');
});

test('account recovery document IDs normalize phone digits and stay stable', () => {
  const first = buildAccountRecoveryDocumentId(normalizePhoneDigits('(555) 123-4567'));
  const second = buildAccountRecoveryDocumentId(normalizePhoneDigits('555-123-4567'));
  const other = buildAccountRecoveryDocumentId(normalizePhoneDigits('(555) 999-0000'));

  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('verification secrets compare only against the matching challenge and value', () => {
  const challengeId = 'challenge-id';
  const secret = '123456';
  const hash = hashVerificationSecret(challengeId, secret);

  assert.equal(verificationSecretsMatch(hash, challengeId, secret), true);
  assert.equal(verificationSecretsMatch(hash, challengeId, '654321'), false);
  assert.equal(verificationSecretsMatch(hash, 'other-challenge', secret), false);
});

test('generated codes use the expected six-digit format', () => {
  assert.match(generateEmailCode(), /^\d{6}$/);
});
