import { FieldValue } from 'firebase-admin/firestore';
import { syncEventRegistrantNames } from './event-registrant-names.js';
import { syncEventRegistrationSheet } from './event-registration-sheet.js';
import {
  SQUARE_API_VERSION,
  buildRefundCompletionUpdate,
  classifySquareRefund,
  getSquareApiBase
} from './square-reconciliation.js';

// Asking Square, rather than waiting to be told.
//
// A refund that Square accepts with status PENDING only becomes Refunded in
// our records when a `refund.updated` webhook arrives saying COMPLETED.
// Nothing else looked. On 2026-11-19 that turned out to matter: the first real
// refund completed at Square, no webhook ever reached production - a read of
// `squareWebhookEvents` found only two Sandbox events from August - and the
// registration sat at Refund Pending with nothing in the system able to move
// it. The webhook is now an optimisation; this is the mechanism.
//
// Deliberately a pull and not a retry of the webhook: a GET against the
// refund we already hold the id for cannot be missed, misrouted, or rejected
// for a signature mismatch, and it needs nothing configured in a dashboard.
const DEFAULT_SWEEP_LIMIT = 25;

export function createSquareRefundFetcher({
  accessToken = process.env.SQUARE_ACCESS_TOKEN || '',
  environment = process.env.SQUARE_ENVIRONMENT || '',
  fetchImpl = fetch
} = {}) {
  return async function fetchRefund(refundId) {
    if (!accessToken) {
      return { error: 'Square access token is not configured.', ok: false };
    }

    if (!refundId) {
      return { error: 'No Square refund id was recorded.', ok: false };
    }

    const url = `${getSquareApiBase(environment)}/v2/refunds/${encodeURIComponent(refundId)}`;
    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Square-Version': SQUARE_API_VERSION
      },
      method: 'GET'
    });
    const text = await response.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return { error: 'Square returned a response that could not be read.', ok: false };
    }

    if (!response.ok) {
      return {
        error: data.errors?.[0]?.detail || `Square refused the refund lookup (${response.status}).`,
        ok: false
      };
    }

    return { ok: true, refund: data.refund || null };
  };
}

// One registration, one decision. Shared by the daily sweep and the admin's
// own Check With Square action so a manual check and an automatic one can
// never reach different conclusions about the same refund.
export async function resolvePendingSquareRefund(db, registrationDoc, { fetchRefund }) {
  const registration = registrationDoc.data() || {};
  const registrationId = registrationDoc.id;
  const squareRefundId = cleanText(registration.squareRefundId);
  const base = {
    email: cleanText(registration.email),
    eventTitle: cleanText(registration.eventTitle),
    registrationId
  };

  if (!squareRefundId) {
    // Nothing to ask about. Left alone rather than flagged: a Refund Pending
    // with no refund id was set by hand, not by Square, and guessing at it
    // would overwrite an admin's own record of what happened.
    return { ...base, outcome: 'skipped', reason: 'no-refund-id' };
  }

  const lookup = await fetchRefund(squareRefundId);

  if (!lookup.ok) {
    return { ...base, outcome: 'error', reason: lookup.error, squareRefundId };
  }

  if (!lookup.refund) {
    return { ...base, outcome: 'error', reason: 'Square returned no refund.', squareRefundId };
  }

  const paymentDoc = await findRegistrationPaymentDoc(db, registration, registrationId);
  const recordedPaymentAmount = Number(
    paymentDoc?.data()?.amount ?? registration.amountPaid ?? 0
  );
  const verdict = classifySquareRefund(lookup.refund, { recordedPaymentAmount });

  if (verdict.outcome !== 'completed') {
    // The refund did not finish. THIS is the moment it becomes something the
    // admin should look at - not the moment it was issued. A refund that
    // Square accepts as PENDING is the ordinary path, so the row written when
    // it was requested is deliberately unflagged; one sweep later, still not
    // completed, is no longer ordinary.
    await flagUnresolvedRefund(db, {
      registration,
      registrationId,
      squareRefundId,
      verdict
    });

    return {
      ...base,
      outcome: verdict.outcome,
      squareRefundId,
      squareStatus: verdict.status
    };
  }

  const now = FieldValue.serverTimestamp();
  const { paymentUpdate, registrationUpdate } = buildRefundCompletionUpdate(lookup.refund, { now });
  const batch = db.batch();

  batch.update(registrationDoc.ref, registrationUpdate);

  if (paymentDoc) {
    batch.update(paymentDoc.ref, paymentUpdate);
  }

  // The follow-up row the refund request wrote. Resolving it here is why the
  // admin never has to open Payment Review for a refund they issued: the
  // thing that opened the item is also the thing that closes it. Clearing it
  // by hand never resolved the registration, which is how a Reviewed item
  // ended up sitting beside a registration still marked Refund Pending.
  batch.set(
    db.collection('squareWebhookEvents').doc(`refund-pending-${squareRefundId}`),
    {
      processedAt: now,
      reconciliationStatus: 'Refund Completed',
      resolvedAt: now,
      resolutionNote: 'A Square refund status check confirmed this pending refund.',
      reviewDetails: {
        message: 'Square reports this refund as completed.',
        squareRefundId,
        squareRefundStatus: verdict.status
      },
      status: 'Processed'
    },
    { merge: true }
  );

  await batch.commit();

  const eventId = cleanText(registration.eventId);

  // The registration was already Cancelled when the refund was requested, so
  // the member-visible list is right either way; the Google Sheet is not - it
  // carries the payment status, which has just changed. Both are best-effort:
  // a Sheets failure must not leave the refund looking unresolved when it is.
  try {
    await syncEventRegistrantNames(db, eventId);
    await syncEventRegistrationSheet(db, eventId);
  } catch (syncError) {
    console.error('Refund completion synced the records but not the sheet', eventId, syncError);
  }

  return {
    ...base,
    amount: verdict.refundAmount,
    eventId,
    outcome: 'completed',
    squareRefundId,
    squareStatus: verdict.status
  };
}

// What a still-unresolved refund says, by what Square answered. Each one is a
// different problem, and "Needs Review" with no reason attached is the state
// this whole mechanism exists to avoid.
function describeUnresolvedRefund(verdict) {
  if (verdict.outcome === 'pending') {
    return 'Square still reports this refund as pending a day after it was requested. '
      + 'A card refund normally completes well inside that, so it is worth checking in Square.';
  }

  if (verdict.outcome === 'rejected') {
    return `Square reports this refund as ${verdict.status}. The money has NOT gone back - `
      + 'the registration is cancelled and still needs refunding another way.';
  }

  if (verdict.outcome === 'partial') {
    return `Square completed a refund of ${verdict.refundAmount} against a larger recorded payment. `
      + 'The difference needs accounting for.';
  }

  return `Square returned an unrecognised refund status (${verdict.status || 'none'}).`;
}

// Promotes the follow-up row the refund request wrote, in place, to something
// the dashboard's attention chip picks up.
//
// Two rows are deliberately left alone. One an admin has already Reviewed:
// they have seen it and written down what they did, and re-flagging it every
// morning would train them to ignore the chip. And one already flagged:
// rewriting it daily would keep moving its timestamps and make an old problem
// look new.
async function flagUnresolvedRefund(db, { registration, registrationId, squareRefundId, verdict }) {
  const reviewRef = db.collection('squareWebhookEvents').doc(`refund-pending-${squareRefundId}`);
  const refundComment = cleanText(registration.paymentNote);
  const existing = await reviewRef.get();
  const currentStatus = existing.exists ? existing.data()?.reconciliationStatus || '' : '';

  if (currentStatus === 'Reviewed' || String(currentStatus).includes('Needs Review')) {
    return;
  }

  const now = FieldValue.serverTimestamp();

  await reviewRef.set(
    {
      eventTitle: cleanText(registration.eventTitle),
      eventType: 'App Initiated Refund',
      objectId: squareRefundId,
      objectType: 'refund',
      processedAt: now,
      // Written only when the row is being created by this sweep - a row the
      // refund request already wrote keeps the time Square was first asked.
      ...(existing.exists ? {} : { receivedAt: now }),
      reconciliationStatus: 'Refund Needs Review',
      registrationEmail: cleanText(registration.email),
      registrationId,
      registrationName: cleanText(registration.name),
      reviewDetails: {
        message: describeUnresolvedRefund(verdict),
        // Carried so a row this sweep CREATES still says why the refund was
        // issued - a refund recorded by the webhook rather than by the refund
        // card has no row for the comment to have been written onto. Omitted
        // rather than blanked when there is nothing to say, so it cannot wipe
        // the comment a row already carries.
        ...(refundComment ? { refundComment } : {}),
        squareRefundId,
        squareRefundStatus: verdict.status || 'Unknown'
      },
      status: 'Processed'
    },
    { merge: true }
  );
}

export async function sweepPendingSquareRefunds(db, {
  fetchRefund = createSquareRefundFetcher(),
  limit = DEFAULT_SWEEP_LIMIT
} = {}) {
  const snapshot = await db
    .collection('registrations')
    .where('paymentStatus', '==', 'Refund Pending')
    .limit(limit)
    .get();

  const results = [];

  // Sequential on purpose. There is never more than a handful of these, and a
  // burst of parallel calls against Square's rate limit would turn a slow
  // sweep into a failed one.
  for (const registrationDoc of snapshot.docs) {
    try {
      results.push(await resolvePendingSquareRefund(db, registrationDoc, { fetchRefund }));
    } catch (error) {
      // One bad registration must not abandon the rest - the next one along
      // may be the refund somebody is waiting on.
      console.error('Square refund check failed', registrationDoc.id, error);
      results.push({
        outcome: 'error',
        reason: error.message || 'Refund check failed.',
        registrationId: registrationDoc.id
      });
    }
  }

  return {
    checked: snapshot.size,
    completed: results.filter((result) => result.outcome === 'completed').length,
    errors: results.filter((result) => result.outcome === 'error').length,
    results,
    stillPending: results.filter((result) => result.outcome === 'pending').length
  };
}

async function findRegistrationPaymentDoc(db, registration, registrationId) {
  const squareTransactionId = cleanText(registration.squareTransactionId);

  if (squareTransactionId) {
    const byTransaction = await db
      .collection('payments')
      .where('squareTransactionId', '==', squareTransactionId)
      .limit(1)
      .get();

    if (!byTransaction.empty) {
      return byTransaction.docs[0];
    }
  }

  const byRegistration = await db
    .collection('payments')
    .where('registrationId', '==', registrationId)
    .limit(1)
    .get();

  return byRegistration.empty ? null : byRegistration.docs[0];
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}
