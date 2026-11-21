import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildRefundCompletionUpdate,
  classifySquareRefund,
  describeRefundCheckOutcome,
  getSquareApiBase
} from '../api/_lib/square-reconciliation.js';
import {
  createSquareRefundFetcher,
  sweepPendingSquareRefunds
} from '../api/_lib/square-refund-sweep.js';

// Why any of this exists: a refund Square accepts as PENDING only became
// Refunded when a refund.updated webhook arrived, and on 2026-11-19 no webhook
// had ever reached production - the first real refund completed at Square and
// the registration stayed at Refund Pending with nothing able to move it.
// These tests cover the pull that replaced that wait.

function fakeDoc(id, data) {
  const doc = { data: () => data, id };

  doc.ref = { id, path: `registrations/${id}` };

  return doc;
}

// reviewDocs is the squareWebhookEvents collection: the follow-up rows a
// refund request writes and the sweep later resolves or flags. Keyed by doc
// id, read and written directly rather than through the batch, because
// flagUnresolvedRefund has to look at what is already there before deciding.
function fakeDb({ paymentsByTransaction = {}, registrations = [], reviewDocs = {} } = {}) {
  const writes = { commits: 0, docSets: [], sets: [], updates: [] };
  const batch = {
    commit: async () => {
      writes.commits += 1;
    },
    set: (ref, data, options) => writes.sets.push({ data, options, ref }),
    update: (ref, data) => writes.updates.push({ data, ref })
  };

  function collection(name) {
    const builder = {
      doc: (id) => ({
        get: async () => ({
          data: () => reviewDocs[id],
          exists: Object.prototype.hasOwnProperty.call(reviewDocs, id)
        }),
        id,
        path: `${name}/${id}`,
        set: async (data, options) => {
          writes.docSets.push({ data, id, options });
          reviewDocs[id] = { ...(reviewDocs[id] || {}), ...data };
        }
      }),
      get: async () => {
        if (name === 'registrations') {
          return { docs: registrations, size: registrations.length };
        }

        const match = paymentsByTransaction[builder.filterValue];

        return match
          ? { docs: [match], empty: false }
          : { docs: [], empty: true };
      },
      limit: () => builder,
      where: (_field, _op, value) => {
        builder.filterValue = value;
        return builder;
      }
    };

    return builder;
  }

  return { batch: () => batch, collection, writes };
}

test('the api base follows the environment, defaulting away from live money', () => {
  assert.equal(getSquareApiBase('production'), 'https://connect.squareup.com');
  assert.equal(getSquareApiBase('sandbox'), 'https://connect.squareupsandbox.com');
  // Anything unset or unrecognised must not reach the live host.
  assert.equal(getSquareApiBase(''), 'https://connect.squareupsandbox.com');
  assert.equal(getSquareApiBase(undefined), 'https://connect.squareupsandbox.com');
});

test('a completed full refund is the only outcome that applies itself', () => {
  assert.deepEqual(
    classifySquareRefund({ amount_money: { amount: 1100 }, status: 'COMPLETED' }, {
      recordedPaymentAmount: 11
    }),
    { outcome: 'completed', refundAmount: 11, status: 'COMPLETED' }
  );

  assert.equal(
    classifySquareRefund({ amount_money: { amount: 1100 }, status: 'PENDING' }).outcome,
    'pending'
  );
  assert.equal(classifySquareRefund({ status: 'REJECTED' }).outcome, 'rejected');
  assert.equal(classifySquareRefund({ status: 'FAILED' }).outcome, 'rejected');
  assert.equal(classifySquareRefund({ status: 'SOMETHING_NEW' }).outcome, 'unknown');
  assert.equal(classifySquareRefund({}).outcome, 'unknown');
  assert.equal(classifySquareRefund(null).outcome, 'unknown');
});

test('a partial refund is never treated as completion', () => {
  // Zeroing amountPaid on a partial refund would record a full refund that
  // never happened, so this has to stay a human decision.
  assert.equal(
    classifySquareRefund({ amount_money: { amount: 500 }, status: 'COMPLETED' }, {
      recordedPaymentAmount: 11
    }).outcome,
    'partial'
  );

  // With no recorded amount to compare against there is nothing to call
  // partial, and refusing to act would strand the refund forever.
  assert.equal(
    classifySquareRefund({ amount_money: { amount: 500 }, status: 'COMPLETED' }).outcome,
    'completed'
  );
});

test('the completion write cancels the registration and zeroes what was paid', () => {
  const { paymentUpdate, registrationUpdate } = buildRefundCompletionUpdate({
    amount_money: { amount: 1100 },
    id: 'refund-1',
    reason: 'Test signup'
  }, { now: 'SERVER_TIME' });

  assert.deepEqual(registrationUpdate, {
    amountPaid: 0,
    paymentMethod: 'Online',
    paymentNote: 'Refund confirmed by Square. Refund ID: refund-1. Reason: Test signup.',
    paymentStatus: 'Refunded',
    paymentUpdatedDate: 'SERVER_TIME',
    squareRefundId: 'refund-1',
    status: 'Cancelled'
  });
  assert.equal(paymentUpdate.amount, 11);
  assert.equal(paymentUpdate.status, 'Refunded');
  assert.equal(paymentUpdate.updatedRegistrationSnapshot.paymentStatus, 'Refunded');
});

test('the sweep completes what Square has completed and leaves the rest alone', async () => {
  // No eventId on purpose: the registrant-names and Sheets syncs both return
  // early without one, which keeps this test to the records it is about.
  const completed = fakeDoc('reg-done', {
    amountPaid: 11,
    email: 'member@example.com',
    paymentStatus: 'Refund Pending',
    squareRefundId: 'refund-done',
    squareTransactionId: 'payment-done'
  });
  const stillPending = fakeDoc('reg-waiting', {
    amountPaid: 25,
    paymentStatus: 'Refund Pending',
    squareRefundId: 'refund-waiting'
  });
  const byHand = fakeDoc('reg-manual', {
    amountPaid: 25,
    paymentStatus: 'Refund Pending'
  });
  const db = fakeDb({
    paymentsByTransaction: {
      'payment-done': { data: () => ({ amount: 11 }), id: 'pay-1', ref: { id: 'pay-1' } }
    },
    registrations: [completed, stillPending, byHand]
  });
  const asked = [];
  const result = await sweepPendingSquareRefunds(db, {
    fetchRefund: async (refundId) => {
      asked.push(refundId);

      return refundId === 'refund-done'
        ? { ok: true, refund: { amount_money: { amount: 1100 }, id: refundId, status: 'COMPLETED' } }
        : { ok: true, refund: { amount_money: { amount: 2500 }, id: refundId, status: 'PENDING' } };
    }
  });

  assert.deepEqual(result.checked, 3);
  assert.equal(result.completed, 1);
  assert.equal(result.stillPending, 1);
  assert.equal(result.errors, 0);

  // The hand-set one is never asked about - there is no refund id to ask with,
  // and inventing one would overwrite an admin's own record.
  assert.deepEqual(asked, ['refund-done', 'refund-waiting']);
  assert.equal(
    result.results.find((entry) => entry.registrationId === 'reg-manual').outcome,
    'skipped'
  );

  // One commit, for the one refund that moved.
  assert.equal(db.writes.commits, 1);
  assert.equal(db.writes.updates.length, 2);
  assert.equal(
    db.writes.updates.find((write) => write.ref.id === 'reg-done').data.paymentStatus,
    'Refunded'
  );
  // And the review row the refund request opened is closed by the same batch.
  assert.equal(db.writes.sets.length, 1);
  assert.equal(db.writes.sets[0].ref.path, 'squareWebhookEvents/refund-pending-refund-done');
  assert.equal(db.writes.sets[0].data.reconciliationStatus, 'Refund Completed');
});

test('one unreachable refund does not abandon the others', async () => {
  const broken = fakeDoc('reg-broken', {
    amountPaid: 11,
    paymentStatus: 'Refund Pending',
    squareRefundId: 'refund-broken'
  });
  const fine = fakeDoc('reg-fine', {
    amountPaid: 11,
    paymentStatus: 'Refund Pending',
    squareRefundId: 'refund-fine'
  });
  const db = fakeDb({ registrations: [broken, fine] });
  const result = await sweepPendingSquareRefunds(db, {
    fetchRefund: async (refundId) => (
      refundId === 'refund-broken'
        ? { error: 'Square is unavailable.', ok: false }
        : { ok: true, refund: { amount_money: { amount: 1100 }, id: refundId, status: 'COMPLETED' } }
    )
  });

  assert.equal(result.errors, 1);
  assert.equal(result.completed, 1);
});

test('the fetcher refuses to call Square with nothing to call it about', async () => {
  const withoutToken = createSquareRefundFetcher({ accessToken: '' });

  assert.equal((await withoutToken('refund-1')).ok, false);

  let requestedUrl = '';
  const fetcher = createSquareRefundFetcher({
    accessToken: 'token',
    environment: 'production',
    fetchImpl: async (url) => {
      requestedUrl = url;

      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ refund: { id: 'refund-1', status: 'COMPLETED' } })
      };
    }
  });

  assert.equal((await fetcher('')).ok, false);

  const lookup = await fetcher('refund-1');

  assert.equal(lookup.ok, true);
  assert.equal(lookup.refund.status, 'COMPLETED');
  assert.equal(requestedUrl, 'https://connect.squareup.com/v2/refunds/refund-1');
});

test("Square's refusal is reported in its own words", async () => {
  const fetcher = createSquareRefundFetcher({
    accessToken: 'token',
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      text: async () => JSON.stringify({ errors: [{ detail: 'Refund not found.' }] })
    })
  });
  const lookup = await fetcher('refund-missing');

  assert.equal(lookup.ok, false);
  assert.equal(lookup.error, 'Refund not found.');
});

test('every outcome tells the admin what happens next', () => {
  assert.match(describeRefundCheckOutcome({ outcome: 'completed' }), /now marked Refunded/);
  assert.match(describeRefundCheckOutcome({ outcome: 'pending' }), /daily check will pick it up/);
  assert.match(describeRefundCheckOutcome({ outcome: 'partial' }), /recorded by hand/);
  assert.match(
    describeRefundCheckOutcome({ outcome: 'rejected', squareStatus: 'REJECTED' }),
    /has not moved/
  );
  assert.match(describeRefundCheckOutcome({ outcome: 'skipped' }), /marked pending by hand/);
  assert.equal(
    describeRefundCheckOutcome({ outcome: 'error', reason: 'Square is unavailable.' }),
    'Square is unavailable.'
  );
  assert.match(describeRefundCheckOutcome({ outcome: 'error' }), /could not be reached/);
  assert.match(describeRefundCheckOutcome({ outcome: 'unknown' }), /does not act on/);
});

// Asked for on 2026-11-21, after a test refund put a "payment needs review"
// on the dashboard the moment it was issued and then asked for a resolution
// note on something that needed no resolution.
//
// A refund Square accepts as PENDING is the ordinary path. The review row is
// written unflagged, and becomes a flagged one only when a later sweep finds
// the refund STILL not completed - one sweep's patience, which the daily cron
// makes about 24 hours.

function pendingRefundRow(overrides = {}) {
  return {
    reconciliationStatus: 'Refund Pending',
    registrationId: 'reg-waiting',
    status: 'Processed',
    ...overrides
  };
}

function sweepOnce({ refundStatus = 'PENDING', reviewDocs = {}, amount = 2500 } = {}) {
  const registration = fakeDoc('reg-waiting', {
    amountPaid: 25,
    email: 'member@example.com',
    eventTitle: 'December Workshop',
    name: 'Ada Lovelace',
    paymentNote: 'Member cancelled, family emergency.',
    paymentStatus: 'Refund Pending',
    squareRefundId: 'refund-waiting'
  });
  const db = fakeDb({ registrations: [registration], reviewDocs });

  return sweepPendingSquareRefunds(db, {
    fetchRefund: async (refundId) => ({
      ok: true,
      refund: { amount_money: { amount }, id: refundId, status: refundStatus }
    })
  }).then((result) => ({ db, result }));
}

test('a refund still pending at the sweep is promoted to Needs Review', async () => {
  const { db } = await sweepOnce({ reviewDocs: { 'refund-pending-refund-waiting': pendingRefundRow() } });
  const write = db.writes.docSets.find((entry) => entry.id === 'refund-pending-refund-waiting');

  assert.ok(write, 'the sweep wrote nothing to the follow-up row');
  assert.equal(write.data.reconciliationStatus, 'Refund Needs Review');
  // The reason has to travel with the flag. "Needs Review" with nothing
  // attached is the state this mechanism exists to avoid.
  assert.match(write.data.reviewDetails.message, /still reports this refund as pending/i);
  assert.equal(write.data.reviewDetails.squareRefundStatus, 'PENDING');
});

test('it does not keep re-flagging a row it already flagged', async () => {
  // Rewriting it every morning would keep moving its timestamps and make an
  // old problem look like a new one.
  const { db } = await sweepOnce({
    reviewDocs: {
      'refund-pending-refund-waiting': pendingRefundRow({ reconciliationStatus: 'Refund Needs Review' })
    }
  });

  assert.equal(db.writes.docSets.length, 0);
});

test('it leaves a row the admin has already reviewed alone', async () => {
  // They have seen it and written down what they did. Flagging it again daily
  // would train them to ignore the chip.
  const { db } = await sweepOnce({
    reviewDocs: {
      'refund-pending-refund-waiting': pendingRefundRow({
        reconciliationStatus: 'Reviewed',
        resolutionNote: 'Called Square, they are reprocessing it.'
      })
    }
  });

  assert.equal(db.writes.docSets.length, 0);
});

test('a rejected refund says the money did not go back', async () => {
  // The dangerous one: the registration is cancelled either way, so without
  // this the guild has a cancelled registration and a member who was never
  // actually refunded.
  const { db } = await sweepOnce({
    refundStatus: 'REJECTED',
    reviewDocs: { 'refund-pending-refund-waiting': pendingRefundRow() }
  });
  const write = db.writes.docSets.find((entry) => entry.id === 'refund-pending-refund-waiting');

  assert.equal(write.data.reconciliationStatus, 'Refund Needs Review');
  assert.match(write.data.reviewDetails.message, /has NOT gone back/);
});

test('a completed refund closes the row instead of flagging it', async () => {
  // The whole point: the ordinary path never reaches the admin at all.
  const { db, result } = await sweepOnce({ refundStatus: 'COMPLETED', amount: 2500 });

  assert.equal(result.completed, 1);
  assert.equal(db.writes.docSets.length, 0);

  const batched = db.writes.sets.find(
    (entry) => entry.ref.id === 'refund-pending-refund-waiting'
  );

  assert.equal(batched.data.reconciliationStatus, 'Refund Completed');
});

test('a flag raised with no row to promote carries the registrant with it', async () => {
  // A refund recorded by the webhook rather than by the refund card has no
  // follow-up row, so the sweep creates one - and a row naming nobody is not
  // worth raising.
  const { db } = await sweepOnce({ reviewDocs: {} });
  const write = db.writes.docSets.find((entry) => entry.id === 'refund-pending-refund-waiting');

  assert.equal(write.data.registrationName, 'Ada Lovelace');
  assert.equal(write.data.registrationEmail, 'member@example.com');
  assert.equal(write.data.eventTitle, 'December Workshop');
  assert.equal(write.data.registrationId, 'reg-waiting');
});

test('the flag carries the refund comment, so the row says why', async () => {
  // The comment typed on the refund card already went to Square as the refund
  // reason and onto the registration. Not having it here is what made Payment
  // Review ask for a note about a refund whose note had already been written.
  const { db } = await sweepOnce({ reviewDocs: {} });
  const write = db.writes.docSets.find((entry) => entry.id === 'refund-pending-refund-waiting');

  assert.equal(write.data.reviewDetails.refundComment, 'Member cancelled, family emergency.');
});

test('a refund with no comment does not blank the one the row already has', async () => {
  // reviewDetails is written whole here, so an empty value would overwrite
  // the comment the refund request put there.
  const registration = fakeDoc('reg-waiting', {
    amountPaid: 25,
    paymentStatus: 'Refund Pending',
    squareRefundId: 'refund-waiting'
  });
  const db = fakeDb({
    registrations: [registration],
    reviewDocs: { 'refund-pending-refund-waiting': pendingRefundRow() }
  });

  await sweepPendingSquareRefunds(db, {
    fetchRefund: async (refundId) => ({
      ok: true,
      refund: { amount_money: { amount: 2500 }, id: refundId, status: 'PENDING' }
    })
  });

  const write = db.writes.docSets.find((entry) => entry.id === 'refund-pending-refund-waiting');

  assert.ok(!('refundComment' in write.data.reviewDetails));
});
