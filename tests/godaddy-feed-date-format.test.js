import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// The embed is a standalone IIFE served as a static asset, so its helpers
// cannot be imported. These tests read the source instead, because the bug
// they guard against was silent: a date-only string that misses the plain-text
// branch still renders a plausible-looking date, just one day early for every
// viewer behind UTC.

const SOURCE = readFileSync(new URL('../public/godaddy-event-feed.js', import.meta.url), 'utf8');

test('the embed reformats ISO dates as text rather than through Date', () => {
  const match = SOURCE.match(/if \((\/\^.*?\/)\.test\(value\)\) \{/);

  assert.ok(match, 'expected a date-shaped guard in formatEventDate');

  // Rebuild the literal the browser would compile and check it does its job.
  const [body, flags] = [match[1].slice(1, match[1].lastIndexOf('/')), ''];
  const pattern = new RegExp(body, flags);

  assert.equal(pattern.test('2026-08-27'), true, 'ISO date must take the text branch');
  assert.equal(pattern.test('2026-08-27T09:30'), false, 'a datetime must fall through');
});

test('no double-escaped character class slips back into the embed', () => {
  // \\d in a regex literal matches a backslash then "d", never a digit, which
  // is what silently disabled the branch above.
  assert.equal(
    SOURCE.includes('\\\\d'),
    false,
    'found \\\\d in godaddy-event-feed.js - a regex character class is double-escaped'
  );
});

test('an ISO date formatted through Date would drift, justifying the text branch', () => {
  const drifted = new Intl.DateTimeFormat('en-US', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'America/New_York',
    year: 'numeric'
  }).format(new Date('2026-08-27'));

  assert.equal(drifted, '08/26/2026');
});
