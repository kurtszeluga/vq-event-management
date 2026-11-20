import assert from 'node:assert/strict';
import test from 'node:test';
import { USER_PERMISSION_OPTIONS } from '../src/data/userRoles.js';

// The labels alone mislead. "Manage Events And Activities" reads as one tab
// and actually opens six - Challenges, Business Listings, For Sale and
// Membership are all event TYPES in the same collection, and Archive is
// archived events - which surprised the person granting it. These descriptions
// are what the admin screen shows under each checkbox, so a permission added
// without one would silently go back to being a bare label.

test('every permission explains itself', () => {
  assert.ok(USER_PERMISSION_OPTIONS.length >= 7);

  for (const option of USER_PERMISSION_OPTIONS) {
    assert.ok(option.key, 'a permission option has no key');
    assert.ok(option.label, `${option.key} has no label`);
    assert.ok(
      typeof option.description === 'string' && option.description.length > 30,
      `${option.key} has no usable description - it would render as a bare label`
    );
    // A description that only restates the label teaches nothing.
    assert.notEqual(option.description.trim(), option.label.trim());
  }
});

test('the events permission names every tab it opens', () => {
  const manageEvents = USER_PERMISSION_OPTIONS.find((option) => option.key === 'manageEvents');

  // These six are gated by this single key in AdminDashboardPage. If a seventh
  // is ever added there, this test should fail until the wording catches up -
  // the whole point is that the breadth is not guessable from the label.
  for (const tab of [
    'Events/Activities',
    'Challenges',
    'Business Listings',
    'For Sale',
    'Membership',
    'Archive'
  ]) {
    assert.ok(
      manageEvents.description.includes(tab),
      `the manageEvents description does not mention ${tab}`
    );
  }
});

test('the payments permission admits it opens nothing by itself', () => {
  // managePayments appears in firestore.rules (reading squareWebhookEvents)
  // and nowhere in the admin module list, so granting it alone looks broken.
  const managePayments = USER_PERMISSION_OPTIONS.find((o) => o.key === 'managePayments');

  assert.match(managePayments.description, /no tab/);
});
