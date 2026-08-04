import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureAuthUserForProfile } from '../api/_lib/auth-account.js';

function stubDb(profile) {
  return {
    collection: () => ({
      doc: () => ({
        get: async () => ({ exists: Boolean(profile), data: () => profile })
      })
    })
  };
}

// The network paths need Identity Platform, but this guard runs before any of
// it - and it is the one that matters, because reaching the REST call with no
// email would create an Auth record just as incomplete as the ones this
// exists to prevent.
test('a profile with no email is left alone rather than creating a bare record', async () => {
  const result = await ensureAuthUserForProfile(stubDb({ email: '' }), 'p', 'some-user');

  assert.deepEqual(result, { changed: false, reason: 'no-profile-email' });
});

test('a missing profile is left alone', async () => {
  const result = await ensureAuthUserForProfile(stubDb(null), 'p', 'missing-user');

  assert.deepEqual(result, { changed: false, reason: 'no-profile-email' });
});

test('a whitespace-only email counts as no email', async () => {
  const result = await ensureAuthUserForProfile(stubDb({ email: '   ' }), 'p', 'some-user');

  assert.equal(result.reason, 'no-profile-email');
});
