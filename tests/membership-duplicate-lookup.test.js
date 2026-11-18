import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPublicLookupResponse } from '../api/registration-lookup.js';

const MEMBERSHIP = { eventType: 'Membership' };
const WORKSHOP = { eventType: 'Workshop' };

function context(overrides = {}) {
  return {
    allowNonMemberRegistration: true,
    event: MEMBERSHIP,
    hasExistingRegistration: false,
    profile: { email: 'member@example.com' },
    ...overrides
  };
}

test('a membership signup tells an anonymous caller the address is already registered', () => {
  // The point of it: otherwise a renewing member waits for a code, fetches it,
  // types it in, and is only then refused. This response is what the browser
  // reads at Submit.
  const response = buildPublicLookupResponse(context({ hasExistingRegistration: true }));

  assert.equal(response.status, 'already-registered');
  assert.equal(response.verificationRequired, false);
});

test('every other event still withholds it', () => {
  // This response goes to anyone who can type an address into a public form,
  // so saying "already registered" would confirm that this person signed up
  // for that class. They are still refused - after the emailed code, where
  // they have proved the address is theirs.
  const response = buildPublicLookupResponse(
    context({ event: WORKSHOP, hasExistingRegistration: true })
  );

  assert.equal(response.status, 'profile-verification-required');
  assert.equal(response.verificationRequired, true);
});

test('a membership signup with no existing registration is unaffected', () => {
  assert.equal(
    buildPublicLookupResponse(context()).status,
    'profile-verification-required'
  );
  assert.equal(
    buildPublicLookupResponse(context({ profile: null })).status,
    'email-verification-required'
  );
});

test('the no-membership refusal still wins over the duplicate one', () => {
  // Order matters: an address with no profile on an event that requires
  // membership is refused for that reason, which is the more useful thing to
  // say, and does not depend on a registration existing.
  const response = buildPublicLookupResponse(context({
    allowNonMemberRegistration: false,
    hasExistingRegistration: true,
    profile: null
  }));

  assert.equal(response.status, 'membership-not-found');
});

test('an undefined event does not disclose', () => {
  // Defensive: isMembershipEvent reads eventType off whatever it is given, and
  // a missing event must not fall through to the disclosing branch.
  assert.equal(
    buildPublicLookupResponse(context({ event: undefined, hasExistingRegistration: true })).status,
    'profile-verification-required'
  );
});
