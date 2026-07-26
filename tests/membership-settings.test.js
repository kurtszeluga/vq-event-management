import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRequireMembershipCheck } from '../api/_lib/membership-settings.js';

// Fail-closed by design: a missing document, a missing field, or a malformed
// value must all behave like the check is on, since the live production
// document already has it explicitly true and this must not silently open
// registration to inactive members on a Firestore hiccup.
test('a missing settings document defaults to requiring membership', () => {
  assert.equal(resolveRequireMembershipCheck(null), true);
  assert.equal(resolveRequireMembershipCheck(undefined), true);
});

test('a document with no requireMembershipCheck field defaults to requiring membership', () => {
  assert.equal(resolveRequireMembershipCheck({}), true);
  assert.equal(resolveRequireMembershipCheck({ matchByEmail: true }), true);
});

test('an explicit boolean value is honoured either way', () => {
  assert.equal(resolveRequireMembershipCheck({ requireMembershipCheck: true }), true);
  assert.equal(resolveRequireMembershipCheck({ requireMembershipCheck: false }), false);
});

test('a malformed non-boolean value defaults to requiring membership rather than being coerced', () => {
  for (const value of ['false', 0, null, undefined, {}, []]) {
    assert.equal(
      resolveRequireMembershipCheck({ requireMembershipCheck: value }),
      true,
      `expected true for requireMembershipCheck: ${JSON.stringify(value)}`
    );
  }
});
