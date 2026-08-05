import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// ensureAuthUserForProfile talks to Identity Platform over fetch, so the
// password detection is lifted out of the source and compiled on its own -
// the same approach tests/godaddy-feed-layout-switcher.test.js uses.
//
// Getting this wrong is quiet in the wrong direction. Reporting a password
// where there is none leaves a member signed in to an account they can never
// sign back into; reporting none where there is one signs a recovering member
// out for no reason.

const SOURCE = readFileSync(new URL('../api/_lib/auth-account.js', import.meta.url), 'utf8');

function extractFunction(name) {
  const start = SOURCE.indexOf(`function ${name}(`);

  assert.notEqual(start, -1, `expected ${name} in auth-account.js`);

  const end = SOURCE.indexOf('\n}', start);

  assert.notEqual(end, -1, `expected ${name} to be closed`);

  return SOURCE.slice(start, end + 2);
}

const authUserHasPassword = new Function(
  `${extractFunction('authUserHasPassword')}\nreturn authUserHasPassword;`
)();

test('a passwordHash counts as a password', () => {
  assert.equal(authUserHasPassword({ passwordHash: 'UkVEQUNURUQ=' }), true);
});

test('a password provider counts as a password', () => {
  // Accounts made through the console carry the provider entry without a hash.
  assert.equal(
    authUserHasPassword({ providerUserInfo: [{ providerId: 'password' }] }),
    true
  );
});

test('an account with neither has no password', () => {
  assert.equal(authUserHasPassword({}), false);
  assert.equal(authUserHasPassword({ providerUserInfo: [] }), false);
  assert.equal(authUserHasPassword(), false);
});

test('another provider alone is not a password', () => {
  assert.equal(
    authUserHasPassword({ providerUserInfo: [{ providerId: 'google.com' }] }),
    false
  );
});

test('a malformed provider list does not throw', () => {
  // The answer decides whether someone is signed out, so it must not be an
  // exception that unwinds the sign-in around it.
  assert.equal(authUserHasPassword({ providerUserInfo: null }), false);
  assert.equal(authUserHasPassword({ providerUserInfo: 'password' }), false);
  assert.equal(authUserHasPassword({ providerUserInfo: [null, undefined] }), false);
});

test('a brand new account is reported as having no password', () => {
  // The created branch returns the literal rather than calling the helper,
  // because there is no Identity Platform record to inspect yet.
  assert.match(
    SOURCE,
    /return \{ changed: true, hasPassword: false, reason: 'created' \};/,
    'a newly created Auth record must report no password'
  );
});

// The guard both code paths actually consult. It is not just "does the account
// have a password" - a profile with no email makes ensureAuthUserForProfile
// bail before touching Identity Platform, and a password set on a record with
// no email can never be used to sign in, so asking for one would strand the
// member in a setup they cannot complete.
const LOOKUP_SOURCE = readFileSync(
  new URL('../api/registration-lookup.js', import.meta.url),
  'utf8'
);

const canSetUpPassword = new Function(
  `${LOOKUP_SOURCE.slice(
    LOOKUP_SOURCE.indexOf('function canSetUpPassword('),
    LOOKUP_SOURCE.indexOf('\n}', LOOKUP_SOURCE.indexOf('function canSetUpPassword(')) + 2
  )}\nreturn canSetUpPassword;`
)();

test('an account with no password is worth asking', () => {
  assert.equal(canSetUpPassword({ hasPassword: false, reason: 'already-complete' }), true);
  assert.equal(canSetUpPassword({ hasPassword: false, reason: 'created' }), true);
  assert.equal(canSetUpPassword({ hasPassword: false, reason: 'email-backfilled' }), true);
});

test('an account that already has one is not', () => {
  assert.equal(canSetUpPassword({ hasPassword: true, reason: 'already-complete' }), false);
});

test('a profile with no email is not, despite reporting no password', () => {
  // The honest answer from the helper is "no password", but there is nothing
  // usable to set one on - so this must not be read as an invitation.
  assert.equal(canSetUpPassword({ hasPassword: false, reason: 'no-profile-email' }), false);
});
