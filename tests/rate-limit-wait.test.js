import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The limiter always knew exactly how long the caller had to wait and threw it
// away, so every 429 said "later". Windows are fixed rather than rolling, so
// "later" was usually a wild overstatement: a one-hour limit hit at five to the
// hour clears in five minutes.
//
// rate-limit.js reaches for node:crypto and firebase-admin, so the wait
// formatter is lifted out and compiled on its own.

const SOURCE = readFileSync(new URL('../api/_lib/rate-limit.js', import.meta.url), 'utf8');

const start = SOURCE.indexOf('function describeWait(');
assert.notEqual(start, -1, 'expected describeWait in rate-limit.js');

const describeWait = new Function(
  `${SOURCE.slice(start, SOURCE.indexOf('\n}', start) + 2)}\nreturn describeWait;`
)();

test('under a minute is given in seconds', () => {
  assert.equal(describeWait(30), 'Try again in 30 seconds.');
  assert.equal(describeWait(60), 'Try again in 60 seconds.');
});

test('one second is not pluralised', () => {
  assert.equal(describeWait(1), 'Try again in 1 second.');
});

test('just over a minute rounds up rather than down', () => {
  // Not "about a minute" - that could send them back a second early, into the
  // same refusal.
  assert.equal(describeWait(61), 'Try again in about 2 minutes.');
});

test('longer waits are given in whole minutes', () => {
  assert.equal(describeWait(300), 'Try again in about 5 minutes.');
  assert.equal(describeWait(3600), 'Try again in about 60 minutes.');
});

test('the wait is always rounded up, never down', () => {
  // Rounding down would send someone back before the window had turned over,
  // so they would hit the same refusal again.
  assert.equal(describeWait(121), 'Try again in about 3 minutes.');
  assert.equal(describeWait(179), 'Try again in about 3 minutes.');
});

test('the thrown message carries the wait, not just the reason', () => {
  assert.match(
    SOURCE,
    /new Error\(`\$\{message\} \$\{describeWait\(retryAfterSeconds\)\}`\)/,
    'expected the 429 message to append the computed wait'
  );
});

test('no rate limit message still ends with the vague sentence', () => {
  // Every `message:` passed to enforceRateLimit now gets a concrete wait
  // appended, so a leftover "try again later" would read as both at once.
  const messages = [];

  for (const file of ['registration-lookup.js', 'create-registration.js', 'admin-update-user-profile.js']) {
    const text = readFileSync(new URL(`../api/${file}`, import.meta.url), 'utf8');

    messages.push(...(text.match(/message: '[^']*'/g) || []));
  }

  assert.ok(messages.length > 0, 'expected to find rate limit messages');

  const vague = messages.filter((message) => /try again later|new code later/i.test(message));

  assert.deepEqual(vague, [], 'these still say "later" and will now say it twice');
});
