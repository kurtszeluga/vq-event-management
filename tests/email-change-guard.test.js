import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleConfirmEmailChange,
  handleStartEmailChange
} from '../api/admin-update-user-profile.js';

// The hole that let a half-applied change through on 2026-11-19.
//
// The endpoint resolves the caller's profile with
// `actorSnap.exists ? actorSnap.data() : {}`, so a token whose uid has no
// profile document arrives here as `{}`. Every gate then read it as healthy:
// `(actorProfile.status || 'Active') !== 'Active'` is false for an empty
// object, and validateEmailChange compared the new address against an
// undefined current one. The Auth record would be updated and the Firestore
// batch would then fail on a users/{uid} document that does not exist -
// leaving the member signing in with one address while every record in the app
// still said the other.
//
// These tests assert the cheap half of the fix: refuse before touching
// anything. The db and the response are fakes that fail loudly if the handler
// gets further than it should.

function fakeResponse() {
  const sent = {};

  return {
    sent,
    status(code) {
      sent.code = code;
      return {
        json(body) {
          sent.body = body;
        }
      };
    }
  };
}

function hostileDb() {
  return {
    batch() {
      throw new Error('the handler must not open a batch for a profile it never found');
    },
    collection() {
      throw new Error('the handler must not read or write for a profile it never found');
    }
  };
}

test('starting a change is refused when no profile document exists', async () => {
  const response = fakeResponse();

  await handleStartEmailChange(
    { body: { action: 'startEmailChange', newEmail: 'new@example.com' } },
    response,
    hostileDb(),
    'uid-with-no-profile',
    {}
  );

  assert.equal(response.sent.code, 404);
  assert.match(response.sent.body.error, /profile could not be found/);
});

test('confirming a change is refused when no profile document exists', async () => {
  const response = fakeResponse();

  await handleConfirmEmailChange(
    { body: { action: 'confirmEmailChange', code: '123456' } },
    response,
    hostileDb(),
    'uid-with-no-profile',
    {}
  );

  assert.equal(response.sent.code, 404);
  assert.match(response.sent.body.error, /profile could not be found/);
});

test('a profile with no email on it is refused too', async () => {
  // Same failure mode by a different route: the notice to the old address has
  // nowhere to go, and there is no previous value to roll back to.
  const response = fakeResponse();

  await handleStartEmailChange(
    { body: { newEmail: 'new@example.com' } },
    response,
    hostileDb(),
    'uid-1',
    { name: 'Ada Lovelace', status: 'Active' }
  );

  assert.equal(response.sent.code, 404);
});

test('an inactive profile is still refused before the profile check', async () => {
  const response = fakeResponse();

  await handleStartEmailChange(
    { body: { newEmail: 'new@example.com' } },
    response,
    hostileDb(),
    'uid-1',
    { email: 'member@example.com', status: 'Archived' }
  );

  assert.equal(response.sent.code, 403);
});
