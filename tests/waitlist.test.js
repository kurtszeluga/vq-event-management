import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WAITLIST_OFFER_WINDOW_MS,
  buildWaitlistOfferToken,
  waitlistOfferTokenMatches
} from '../api/_lib/waitlist.js';

test('the offer window is generous enough to absorb once-daily cron checking', () => {
  // Vercel's Hobby plan cron only runs once a day - see api/_lib/waitlist.js.
  // A window under 24h could expire before the cron ever gets a chance to
  // check it.
  assert.ok(WAITLIST_OFFER_WINDOW_MS > 24 * 60 * 60 * 1000);
});

test('a claim token only matches the registration it was built for', () => {
  const { token, tokenHash } = buildWaitlistOfferToken('registration-a');

  assert.equal(waitlistOfferTokenMatches('registration-a', token, tokenHash), true);
  assert.equal(waitlistOfferTokenMatches('registration-b', token, tokenHash), false);
  assert.equal(waitlistOfferTokenMatches('registration-a', 'wrong-token', tokenHash), false);
});

test('each generated token is unique', () => {
  const first = buildWaitlistOfferToken('registration-a');
  const second = buildWaitlistOfferToken('registration-a');

  assert.notEqual(first.token, second.token);
  assert.notEqual(first.tokenHash, second.tokenHash);
});
