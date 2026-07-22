import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublicLookupResponse } from '../api/registration-lookup.js';
import {
  buildVerificationDocumentId,
  generateEmailCode,
  generateRegistrationToken,
  hashVerificationSecret,
  verificationSecretsMatch
} from '../api/_lib/registration-verification.js';

test('public profile lookup never returns member contact or billing details', () => {
  const response = buildPublicLookupResponse({
    allowNonMemberRegistration: false,
    profile: {
      billingAddress: { street: 'Private Street' },
      email: 'member@example.com',
      name: 'Private Member',
      phone: '555-555-5555'
    }
  });
  const serialized = JSON.stringify(response);

  assert.equal(response.profileExists, true);
  assert.equal(response.status, 'profile-verification-required');
  assert.equal(response.verificationRequired, true);
  assert.equal(serialized.includes('Private Member'), false);
  assert.equal(serialized.includes('Private Street'), false);
  assert.equal(serialized.includes('555-555-5555'), false);
  assert.equal(serialized.includes('member@example.com'), false);
});

test('non-member event lookup requires email verification before registration', () => {
  const response = buildPublicLookupResponse({
    allowNonMemberRegistration: true,
    profile: null
  });

  assert.deepEqual(response, {
    allowNonMemberRegistration: true,
    profileExists: false,
    status: 'email-verification-required',
    verificationRequired: true
  });
});

test('verification document IDs normalize email and remain event-specific', () => {
  const first = buildVerificationDocumentId(' Member@Example.com ', 'event-a');
  const second = buildVerificationDocumentId('member@example.com', 'event-a');
  const otherEvent = buildVerificationDocumentId('member@example.com', 'event-b');

  assert.equal(first, second);
  assert.notEqual(first, otherEvent);
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

test('generated codes and registration tokens use expected formats', () => {
  assert.match(generateEmailCode(), /^\d{6}$/);
  assert.ok(generateRegistrationToken().length >= 40);
});
