import assert from 'node:assert/strict';
import test from 'node:test';
import { createVerify, generateKeyPairSync } from 'node:crypto';
import {
  buildAccountRecoveryDocumentId,
  classifyRecoveryIdentifier,
  createFirebaseCustomToken,
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

test('classifyRecoveryIdentifier detects email by shape and normalizes it', () => {
  assert.deepEqual(
    classifyRecoveryIdentifier(' Member@Example.com '),
    { type: 'email', value: 'member@example.com' }
  );
});

test('classifyRecoveryIdentifier detects a 10-digit phone number in any format', () => {
  assert.deepEqual(
    classifyRecoveryIdentifier('(555) 123-4567'),
    { type: 'phone', value: '5551234567' }
  );
  assert.deepEqual(
    classifyRecoveryIdentifier('555.123.4567'),
    { type: 'phone', value: '5551234567' }
  );
});

test('classifyRecoveryIdentifier rejects anything that is neither', () => {
  assert.deepEqual(classifyRecoveryIdentifier('555-123'), { type: null, value: '' });
  assert.deepEqual(classifyRecoveryIdentifier(''), { type: null, value: '' });
  assert.deepEqual(classifyRecoveryIdentifier('   '), { type: null, value: '' });
});

test('account recovery document IDs are stable per type and differ across types and values', () => {
  const emailFirst = buildAccountRecoveryDocumentId('email', 'member@example.com');
  const emailSecond = buildAccountRecoveryDocumentId('email', 'member@example.com');
  const phoneSameValue = buildAccountRecoveryDocumentId('phone', 'member@example.com');
  const otherPhone = buildAccountRecoveryDocumentId('phone', '5551234567');

  assert.equal(emailFirst, emailSecond);
  assert.notEqual(emailFirst, phoneSameValue);
  assert.notEqual(phoneSameValue, otherPhone);
  assert.match(emailFirst, /^[a-f0-9]{64}$/);
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

test('createFirebaseCustomToken produces a Firebase-shaped JWT signed with the service account key', () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const originalServiceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'test@example.iam.gserviceaccount.com',
    private_key: privateKey.export({ format: 'pem', type: 'pkcs1' })
  });

  try {
    const token = createFirebaseCustomToken('some-uid');
    const [encodedHeader, encodedPayload, encodedSignature] = token.split('.');

    assert.equal(token.split('.').length, 3);

    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString());
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString());

    assert.deepEqual(header, { alg: 'RS256', typ: 'JWT' });
    assert.equal(payload.uid, 'some-uid');
    assert.equal(payload.iss, 'test@example.iam.gserviceaccount.com');
    assert.equal(payload.sub, 'test@example.iam.gserviceaccount.com');
    assert.equal(
      payload.aud,
      'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit'
    );
    assert.ok(payload.exp > payload.iat);

    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${encodedHeader}.${encodedPayload}`);
    assert.equal(verifier.verify(publicKey, Buffer.from(encodedSignature, 'base64url')), true);
  } finally {
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON = originalServiceAccountJson;
  }
});
