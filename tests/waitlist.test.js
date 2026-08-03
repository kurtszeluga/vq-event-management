import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WAITLIST_OFFER_WINDOW_MS,
  buildWaitlistOfferToken,
  createNextWaitlistOffer,
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

// A minimal Firestore stand-in: enough to let createNextWaitlistOffer run its
// queries and report which collections it touched.
function stubDb({ waitlisted = [], allRegistrations = [], emailSettings = {} } = {}) {
  const touched = [];

  function snapshot(rows) {
    return {
      docs: rows.map((row) => ({ id: row.id, data: () => row })),
      empty: rows.length === 0
    };
  }

  return {
    touched,
    collection(name) {
      touched.push(name);

      if (name === 'appSettings') {
        return { doc: () => ({ get: async () => ({ exists: true, data: () => emailSettings }) }) };
      }

      const chain = {
        where(field, _op, value) {
          if (field === 'status' && value === 'Waitlisted') {
            chain._waitlistedOnly = true;
          }
          return chain;
        },
        orderBy: () => chain,
        get: async () => snapshot(chain._waitlistedOnly ? waitlisted : allRegistrations),
        doc: () => ({ update: async () => {} })
      };

      return chain;
    }
  };
}

test('an unlimited-capacity event skips waitlist processing entirely', async () => {
  const db = stubDb({ waitlisted: [], allRegistrations: [] });
  const result = await createNextWaitlistOffer(db, {
    id: 'c1',
    capacityUnlimited: true,
    eventType: 'Challenges',
    title: 'Great American Birthday Bash'
  });

  assert.equal(result, null);
  // Nothing queried at all - there is no seat scarcity to resolve.
  assert.deepEqual(db.touched, []);
});

// Cancelling the only registration on an event nobody was waiting for used to
// email a coordinator that a seat had opened and the waitlist was empty.
test('an empty waitlist sends no coordinator email', async () => {
  const db = stubDb({
    waitlisted: [],
    allRegistrations: [],
    emailSettings: { sendCoordinatorRegistrationNotifications: true }
  });
  const result = await createNextWaitlistOffer(db, {
    id: 'e1',
    capacity: 20,
    eventType: 'Workshop',
    title: 'Curved Seams'
  });

  assert.equal(result, null);
  // appSettings is only read when the exhausted email is actually being built.
  assert.ok(!db.touched.includes('appSettings'));
});

test('a waitlist that exists but cannot be drawn from still notifies', async () => {
  const offered = {
    id: 'r1',
    status: 'Waitlisted',
    waitlistOfferExpiresAt: { toMillis: () => Date.now() + 60_000 }
  };
  const db = stubDb({
    waitlisted: [offered],
    allRegistrations: [offered],
    emailSettings: { sendCoordinatorRegistrationNotifications: true }
  });
  const result = await createNextWaitlistOffer(db, {
    id: 'e1',
    capacity: 20,
    eventType: 'Workshop',
    title: 'Curved Seams'
  });

  assert.equal(result, null);
  assert.ok(db.touched.includes('appSettings'));
});
