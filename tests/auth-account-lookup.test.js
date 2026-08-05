import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// lookupAuthAccounts talks to Identity Platform over fetch, so the shaping is
// lifted out and compiled against a stubbed request - the same approach the
// other auth-account tests use.
//
// What matters here is that a profile with no Auth record still comes back.
// Every CSV-imported member is one of those until their first code, so a caller
// left to tell "absent" from "not asked for" would report the whole roster as
// unknown rather than as never signed in.

const SOURCE = readFileSync(new URL('../api/_lib/auth-account.js', import.meta.url), 'utf8');

function extractBlock(startPattern, closer) {
  const start = SOURCE.indexOf(startPattern);

  assert.notEqual(start, -1, `expected ${startPattern} in auth-account.js`);

  const end = SOURCE.indexOf(closer, start);

  assert.notEqual(end, -1, `expected ${startPattern} to be closed`);

  return SOURCE.slice(start, end + closer.length);
}

function buildLookup(users, onRequest = () => {}) {
  return new Function('identityPlatformRequest', `
    ${extractBlock('const AUTH_LOOKUP_CHUNK_SIZE', ';')}
    ${extractBlock('export async function lookupAuthAccounts', '\n}').replace('export ', '')}
    ${extractBlock('function authUserHasPassword', '\n}')}
    return lookupAuthAccounts;
  `)(async (projectId, methodPath, body) => {
    onRequest(body);
    return { users: users.filter((user) => body.localId.includes(user.localId)) };
  });
}

test('a profile with no Auth record reads as never signed in', async () => {
  const lookup = buildLookup([]);
  const accounts = await lookup('p', ['imported-member']);

  assert.deepEqual(accounts['imported-member'], {
    createdAt: 0,
    hasPassword: false,
    lastSignInAt: 0
  });
});

test('timestamps come back as numbers, not the strings the API sends', async () => {
  const lookup = buildLookup([
    { createdAt: '1754000000000', lastLoginAt: '1754400000000', localId: 'member-1', passwordHash: 'x' }
  ]);
  const accounts = await lookup('p', ['member-1']);

  assert.deepEqual(accounts['member-1'], {
    createdAt: 1754000000000,
    hasPassword: true,
    lastSignInAt: 1754400000000
  });
});

test('an account that exists but has never signed in reads as never', async () => {
  const lookup = buildLookup([{ createdAt: '1754000000000', localId: 'member-2' }]);
  const accounts = await lookup('p', ['member-2']);

  assert.equal(accounts['member-2'].lastSignInAt, 0);
  assert.equal(accounts['member-2'].hasPassword, false);
});

test('duplicate ids are asked for once', async () => {
  const asked = [];
  const lookup = buildLookup([], (body) => asked.push(...body.localId));

  await lookup('p', ['member-1', 'member-1', '', null, 'member-2']);

  assert.deepEqual(asked, ['member-1', 'member-2']);
});

test('a long roster is chunked rather than sent as one request', async () => {
  // Identity Platform caps the ids per call, so 250 members must not become a
  // single rejected request.
  const requests = [];
  const ids = Array.from({ length: 250 }, (_, index) => `member-${index}`);
  const lookup = buildLookup([], (body) => requests.push(body.localId.length));

  const accounts = await lookup('p', ids);

  assert.deepEqual(requests, [100, 100, 50]);
  assert.equal(Object.keys(accounts).length, 250);
});

test('an empty list makes no request at all', async () => {
  const requests = [];
  const lookup = buildLookup([], (body) => requests.push(body));

  const accounts = await lookup('p', []);

  assert.deepEqual(requests, []);
  assert.deepEqual(accounts, {});
});
