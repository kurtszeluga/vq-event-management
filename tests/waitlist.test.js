import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_WAITLIST_OFFERS_PER_EVENT_SAVE,
  WAITLIST_OFFER_WINDOW_MS,
  buildWaitlistOfferToken,
  createNextWaitlistOffer,
  offerFreedSeatsToWaitlist,
  waitlistOfferTokenMatches
} from '../api/_lib/waitlist.js';
import { didCapacityGrow, isSeatHoldingRegistration } from '../api/_lib/registration-capacity.js';

test('the offer window is one day', () => {
  assert.equal(WAITLIST_OFFER_WINDOW_MS, 24 * 60 * 60 * 1000);
});

// This replaces an assertion that the window had to exceed 24h, on the
// reasoning that a shorter one "could expire before the cron gets a chance to
// check it". The sweep is not what frees the seat, so that was never the
// constraint - and pinning the real guarantee is worth more than pinning a
// number the next person would have to re-derive.
test('an elapsed offer stops holding its seat without any sweep running', () => {
  const offeredAt = Date.now();
  const registration = {
    status: 'Waitlisted',
    waitlistOfferExpiresAt: { toMillis: () => offeredAt + WAITLIST_OFFER_WINDOW_MS }
  };

  assert.equal(isSeatHoldingRegistration(registration, offeredAt), true);
  // One millisecond past the deadline, with waitlistOfferExpiresAt still
  // written on the record because the daily cron has not come round yet.
  assert.equal(
    isSeatHoldingRegistration(registration, offeredAt + WAITLIST_OFFER_WINDOW_MS + 1),
    false
  );
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

// A stateful stand-in, unlike stubDb above: offerFreedSeatsToWaitlist loops
// until createNextWaitlistOffer stops finding seats, and the only reason it
// ever stops is that each offer it writes makes the next pass see one fewer
// free seat. A stub that discards writes would loop until the cap every time
// and prove nothing.
function stubSeatedDb({ rows = [], emailSettings = {} } = {}) {
  const registrations = rows.map((row) => ({ ...row }));

  function snapshot(list) {
    return {
      docs: list.map((row) => ({ id: row.id, data: () => row })),
      empty: list.length === 0
    };
  }

  return {
    registrations,
    offeredIds: () => registrations
      .filter((row) => row.waitlistOfferExpiresAt)
      .map((row) => row.id),
    collection(name) {
      if (name === 'appSettings') {
        return { doc: () => ({ get: async () => ({ exists: true, data: () => emailSettings }) }) };
      }

      const chain = {
        where(field, _op, value) {
          if (field === 'status' && value === 'Waitlisted') {
            chain.waitlistedOnly = true;
          }

          return chain;
        },
        orderBy: () => chain,
        get: async () => snapshot(
          chain.waitlistedOnly
            ? registrations.filter((row) => row.status === 'Waitlisted')
            : registrations
        ),
        doc: (id) => ({
          update: async (fields) => {
            Object.assign(registrations.find((row) => row.id === id), fields);
          }
        })
      };

      return chain;
    }
  };
}

function seatedRow(id) {
  return { id, eventId: 'e1', status: 'Registered' };
}

function waitingRow(id) {
  return { id, email: `${id}@example.com`, eventId: 'e1', name: id, status: 'Waitlisted' };
}

test('adding seats offers exactly that many, not the whole waitlist', async () => {
  const db = stubSeatedDb({
    rows: [
      ...Array.from({ length: 12 }, (_, index) => seatedRow(`seated-${index}`)),
      ...Array.from({ length: 5 }, (_, index) => waitingRow(`waiting-${index}`))
    ]
  });
  const result = await offerFreedSeatsToWaitlist(db, { id: 'e1', capacity: 15, title: 'Curved Seams' });

  assert.equal(result.offersMade, 3);
  // In waitlist order, and nobody beyond the three new seats.
  assert.deepEqual(db.offeredIds(), ['waiting-0', 'waiting-1', 'waiting-2']);
});

test('a shorter waitlist than the seats added stops at the waitlist', async () => {
  const db = stubSeatedDb({
    rows: [seatedRow('seated-0'), waitingRow('waiting-0'), waitingRow('waiting-1')]
  });
  const result = await offerFreedSeatsToWaitlist(db, { id: 'e1', capacity: 40, title: 'Curved Seams' });

  assert.equal(result.offersMade, 2);
  assert.deepEqual(db.offeredIds(), ['waiting-0', 'waiting-1']);
});

// createNextWaitlistOffer refuses unlimited-capacity events, because a
// cancellation on one frees nothing. Switching an event TO unlimited is the
// opposite case and has to seat everyone waiting.
test('switching an event to unlimited capacity offers every waiting seat', async () => {
  const db = stubSeatedDb({
    rows: [
      seatedRow('seated-0'),
      waitingRow('waiting-0'),
      waitingRow('waiting-1'),
      waitingRow('waiting-2')
    ]
  });
  const result = await offerFreedSeatsToWaitlist(db, {
    id: 'e1',
    capacityUnlimited: true,
    title: 'Curved Seams'
  });

  assert.equal(result.offersMade, 3);
  assert.deepEqual(db.offeredIds(), ['waiting-0', 'waiting-1', 'waiting-2']);
});

// The "seat opened, waitlist empty" email is news after a cancellation. On a
// capacity increase it would fire on the last pass of every single save, so
// offerFreedSeatsToWaitlist turns it off - this is the same scenario as "a
// waitlist that exists but cannot be drawn from still notifies" above, at the
// opposite setting.
test('the exhausted-waitlist email can be turned off for the capacity path', async () => {
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
  }, { notifyWhenExhausted: false });

  assert.equal(result, null);
  // appSettings is only read when an email is actually being built.
  assert.ok(!db.touched.includes('appSettings'));
});

test('a capacity increase never offers more than the cap, whatever the data says', async () => {
  const db = stubSeatedDb({
    rows: Array.from({ length: MAX_WAITLIST_OFFERS_PER_EVENT_SAVE + 10 }, (_, index) =>
      waitingRow(`waiting-${index}`))
  });
  const result = await offerFreedSeatsToWaitlist(db, {
    id: 'e1',
    capacityUnlimited: true,
    title: 'Curved Seams'
  });

  assert.equal(result.offersMade, MAX_WAITLIST_OFFERS_PER_EVENT_SAVE);
});

test('didCapacityGrow only reports edits that actually added seats', () => {
  assert.equal(didCapacityGrow({ capacity: 12 }, { capacity: 15 }), true);
  assert.equal(didCapacityGrow({ capacity: 12 }, { capacity: 12 }), false);
  assert.equal(didCapacityGrow({ capacity: 15 }, { capacity: 12 }), false);
  assert.equal(didCapacityGrow({ capacity: 12 }, { capacityUnlimited: true }), true);
  // Already unlimited: it never ran out of seats, so none were added.
  assert.equal(didCapacityGrow({ capacityUnlimited: true }, { capacityUnlimited: true }), false);
  // Unlimited down to a number is a reduction, however large the number.
  assert.equal(didCapacityGrow({ capacityUnlimited: true }, { capacity: 500 }), false);
  // A brand-new event has no "before" capacity to grow from.
  assert.equal(didCapacityGrow({}, { capacity: 20 }), true);
});
