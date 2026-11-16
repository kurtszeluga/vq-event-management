import assert from 'node:assert/strict';
import test from 'node:test';
import { EVENT_CATEGORY_CONFIG } from '../api/_lib/public-event-feed.js';
import {
  NON_REGISTRABLE_EVENT_TYPES,
  getRegistrationWindowState
} from '../shared/registrationWindow.js';
import { eventTakesRegistrations } from '../shared/eventRegistrationSheet.js';
import { LISTING_EVENT_TYPES } from '../shared/eventListing.js';

const OPEN_MEMBERSHIP_EVENT = {
  eventType: 'Membership',
  registrationMode: 'now',
  status: 'Published'
};

test('Membership is excluded from every feed category that could list it', () => {
  // The categories that select by allowedTypes cannot include it by
  // construction; the two that select by exclusion have to name it. Checked
  // across every category so a new one added later fails here rather than
  // quietly publishing the signup to the website.
  for (const [name, config] of Object.entries(EVENT_CATEGORY_CONFIG)) {
    if (config.allowedTypes) {
      assert.ok(
        !config.allowedTypes.includes('Membership'),
        `category '${name}' allows Membership`
      );
      continue;
    }

    assert.ok(
      config.excludedTypes?.includes('Membership'),
      `category '${name}' does not exclude Membership`
    );
  }
});

test('Membership still takes registrations - it is hidden, not disabled', () => {
  // The mistake this guards against is reaching for the For Sale machinery,
  // which would make the signup unlisted AND unregistrable in one move.
  assert.ok(!NON_REGISTRABLE_EVENT_TYPES.includes('Membership'));
  assert.ok(!LISTING_EVENT_TYPES.includes('Membership'));
  assert.ok(eventTakesRegistrations(OPEN_MEMBERSHIP_EVENT));
  assert.equal(getRegistrationWindowState(OPEN_MEMBERSHIP_EVENT).state, 'open');
});

test('a Membership event still closes on its registration dates like any other', () => {
  const closed = {
    ...OPEN_MEMBERSHIP_EVENT,
    registrationCloseAt: '2026-06-01T17:00'
  };

  assert.equal(
    getRegistrationWindowState(closed, { now: Date.UTC(2026, 6, 1, 12, 0, 0) }).state,
    'closed'
  );
});
