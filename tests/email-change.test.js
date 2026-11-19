import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEmailChangeChallengeId,
  buildEmailChangeCodeEmail,
  buildEmailChangedNotice,
  getEmailCodeSendDecision,
  validateEmailChange
} from '../api/_lib/email-change.js';

// A member changing their own email. The field was read-only on ProfilePage
// and the Firestore rules now refuse a direct change, so this flow is the only
// way it moves - and the reason it needs a code is that the new address
// becomes what the member signs in with. A typo there sends password reset
// somewhere they cannot read.

test('the new address has to be a plausible, different address', () => {
  assert.equal(validateEmailChange({ newEmail: '' }).ok, false);
  assert.equal(validateEmailChange({ newEmail: '   ' }).ok, false);
  assert.equal(validateEmailChange({ newEmail: 'not-an-address' }).ok, false);
  assert.equal(validateEmailChange({ newEmail: 'missing@domain' }).ok, false);
  assert.equal(validateEmailChange({ newEmail: 'two parts@example.com' }).ok, false);
  assert.equal(
    validateEmailChange({ newEmail: `${'a'.repeat(250)}@example.com` }).ok,
    false
  );
});

test('the address is normalised, so case and spacing cannot fake a change', () => {
  const result = validateEmailChange({
    currentEmail: 'member@example.com',
    newEmail: '  NewAddress@Example.COM  '
  });

  assert.equal(result.ok, true);
  assert.equal(result.email, 'newaddress@example.com');

  // Same address in different clothes is not a change, and letting it through
  // would send a code and rewrite the Auth record for nothing.
  const unchanged = validateEmailChange({
    currentEmail: 'member@example.com',
    newEmail: 'Member@Example.com'
  });

  assert.equal(unchanged.ok, false);
  assert.match(unchanged.error, /already the email address/);
});

test('the challenge id is per member and stable', () => {
  // Stable, so a second request replaces the first rather than leaving two
  // live challenges; per member, so one member's code cannot be presented
  // against another's pending change.
  assert.equal(
    buildEmailChangeChallengeId('uid-1'),
    buildEmailChangeChallengeId('uid-1')
  );
  assert.notEqual(
    buildEmailChangeChallengeId('uid-1'),
    buildEmailChangeChallengeId('uid-2')
  );
  assert.match(buildEmailChangeChallengeId('uid-1'), /^[0-9a-f]{64}$/);
});

test('a first code is allowed and starts the window', () => {
  const decision = getEmailCodeSendDecision({ challenge: {}, now: 1_000_000 });

  assert.equal(decision.allowed, true);
  assert.equal(decision.sendCount, 1);
  assert.equal(decision.inCurrentWindow, false);
});

test('a code requested again within the minute is refused', () => {
  const now = 1_000_000;
  const decision = getEmailCodeSendDecision({
    challenge: { lastSentAt: now - 30_000, sendCount: 1, sendWindowStartedAt: now - 30_000 },
    now
  });

  assert.equal(decision.allowed, false);
  assert.equal(decision.statusCode, 429);
  assert.match(decision.error, /wait one minute/);
});

test('the fifth code in an hour is the last', () => {
  const now = 10_000_000;
  const windowStart = now - 30 * 60 * 1000;

  assert.equal(
    getEmailCodeSendDecision({
      challenge: { lastSentAt: now - 120_000, sendCount: 4, sendWindowStartedAt: windowStart },
      now
    }).allowed,
    true
  );

  const sixth = getEmailCodeSendDecision({
    challenge: { lastSentAt: now - 120_000, sendCount: 5, sendWindowStartedAt: windowStart },
    now
  });

  assert.equal(sixth.allowed, false);
  assert.equal(sixth.statusCode, 429);
});

test('the count resets once the window has passed', () => {
  const now = 10_000_000;
  const decision = getEmailCodeSendDecision({
    challenge: {
      lastSentAt: now - 2 * 60 * 60 * 1000,
      sendCount: 5,
      sendWindowStartedAt: now - 2 * 60 * 60 * 1000
    },
    now
  });

  assert.equal(decision.allowed, true);
  assert.equal(decision.sendCount, 1);
});

test('the code email says nothing has changed yet', () => {
  const email = buildEmailChangeCodeEmail({ code: '123456' });

  assert.match(email.html, /123456/);
  assert.match(email.html, /will not change until you enter it/);
  assert.match(email.text, /123456/);
  // Someone who did not ask for this must be told it is harmless to ignore,
  // or the message reads as a breach notice.
  assert.match(email.html, /did not ask to change/);
});

test('the notice to the old address names the new one and what to do', () => {
  const notice = buildEmailChangedNotice({ newEmail: 'newaddress@example.com' });

  assert.match(notice.html, /newaddress@example\.com/);
  assert.match(notice.text, /newaddress@example\.com/);
  // This email is the only warning a member gets if somebody else moved their
  // account, so it has to say so plainly.
  assert.match(notice.html, /If you did not do this/);
  assert.match(notice.html, /administrator/);
});

test('an address with html in it cannot inject into either email', () => {
  const notice = buildEmailChangedNotice({
    newEmail: '"><script>alert(1)</script>@example.com'
  });

  assert.equal(notice.html.includes('<script>'), false);
  assert.match(notice.html, /&lt;script&gt;/);
});
