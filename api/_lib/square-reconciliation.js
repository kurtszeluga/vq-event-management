export function getSquareAmount(amountMoney = {}) {
  return Number(amountMoney.amount || 0) / 100;
}

// Square emits payment.updated alongside a refund. Those updates carry refund
// data and must not be reconciled as fresh payments or they create false
// Needs Review rows in Payment Review.
export function isRefundSidePaymentUpdate(squarePayment = {}) {
  const refundedAmount = getSquareAmount(squarePayment.refunded_money);
  const refundIds = Array.isArray(squarePayment.refund_ids) ? squarePayment.refund_ids : [];

  return refundedAmount > 0 || refundIds.length > 0;
}

export const SQUARE_API_VERSION = '2026-05-20';

export function getSquareApiBase(environment) {
  return String(environment || '').trim() === 'production'
    ? 'https://connect.squareup.com'
    : 'https://connect.squareupsandbox.com';
}

// Square's own wording for a refund, kept verbatim on the registration so the
// note an admin reads is the processor's account of it rather than ours.
export function buildRefundNote(squareRefund = {}) {
  const reason = cleanText(squareRefund.reason);
  const refundId = cleanText(squareRefund.id);

  return [
    'Refund confirmed by Square.',
    refundId ? `Refund ID: ${refundId}.` : '',
    reason ? `Reason: ${reason}.` : ''
  ].filter(Boolean).join(' ');
}

// One reading of a Square refund, shared by the webhook and the daily sweep.
// They used to disagree by construction - the webhook treated anything that
// was not COMPLETED as "no action at all" and returned null, which is right
// for a webhook (another one will arrive) and wrong for a sweep, which has to
// know whether to look again tomorrow or stop. Naming the outcomes is what
// lets both callers behave correctly off the same decision.
//
// `partial` is deliberately not treated as completion. A refund smaller than
// the payment means somebody refunded part of it in Square directly, and
// zeroing amountPaid would then record a full refund that never happened.
export function classifySquareRefund(squareRefund, { recordedPaymentAmount = 0 } = {}) {
  const status = cleanText(squareRefund?.status).toUpperCase();
  const refundAmount = getSquareAmount(squareRefund?.amount_money);
  const recorded = Number(recordedPaymentAmount || 0);

  if (status === 'COMPLETED') {
    // Half a cent of tolerance: both sides came from integer cents, so this
    // only guards against a float round-trip, never a real shortfall.
    if (recorded > 0 && refundAmount < recorded - 0.005) {
      return { outcome: 'partial', refundAmount, status };
    }

    return { outcome: 'completed', refundAmount, status };
  }

  if (status === 'PENDING') {
    return { outcome: 'pending', refundAmount, status };
  }

  if (status === 'REJECTED' || status === 'FAILED') {
    return { outcome: 'rejected', refundAmount, status };
  }

  return { outcome: 'unknown', refundAmount, status };
}

// The writes a completed refund produces. Returned rather than applied so the
// webhook can put them in its batch and the sweep in its own, and so the shape
// has one definition instead of two that drift.
export function buildRefundCompletionUpdate(squareRefund = {}, { now = null } = {}) {
  const note = buildRefundNote(squareRefund);
  const squareRefundId = cleanText(squareRefund.id);

  return {
    registrationUpdate: {
      amountPaid: 0,
      paymentMethod: 'Online',
      paymentNote: note,
      paymentStatus: 'Refunded',
      paymentUpdatedDate: now,
      squareRefundId,
      status: 'Cancelled'
    },
    paymentUpdate: {
      amount: getSquareAmount(squareRefund.amount_money),
      method: 'Online',
      note,
      processor: 'Square',
      registrationStatus: 'Cancelled',
      squareRefundId,
      status: 'Refunded',
      updatedRegistrationSnapshot: {
        amountPaid: 0,
        paymentMethod: 'Online',
        paymentPreference: 'online',
        paymentStatus: 'Refunded',
        status: 'Cancelled'
      }
    }
  };
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

// Plain wording for an admin who pressed Check With Square. The outcome names
// are for code; these are for a person deciding whether to wait or to go into
// Square themselves, so every branch says what happens next rather than only
// what Square said.
export function describeRefundCheckOutcome(result = {}) {
  const status = cleanText(result.squareStatus);

  switch (result.outcome) {
    case 'completed':
      return 'Square confirms the refund completed. The registration is now marked Refunded.';
    case 'pending':
      return 'Square still has this refund as pending. Card refunds can take a few business days; '
        + 'the daily check will pick it up as soon as Square completes it.';
    case 'partial':
      return 'Square reports a refund smaller than the payment, so this was not applied. '
        + 'A partial refund has to be recorded by hand.';
    case 'rejected':
      return `Square reports this refund as ${status || 'rejected'}. The money has not moved - `
        + 'issue it again in Square, or record what happened on the registration.';
    case 'skipped':
      return 'No Square refund id was recorded on this registration, so there is nothing to look '
        + 'up. This refund was marked pending by hand rather than through Square.';
    case 'error':
      return cleanText(result.reason) || 'Square could not be reached.';
    default:
      return `Square reports this refund as ${status || 'an unrecognised status'}, which this `
        + 'system does not act on. Check the refund in Square directly.';
  }
}
