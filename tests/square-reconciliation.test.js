import assert from 'node:assert/strict';
import test from 'node:test';
import { getSquareAmount, isRefundSidePaymentUpdate } from '../api/_lib/square-reconciliation.js';

test('square amounts convert from cents without float drift', () => {
  assert.equal(getSquareAmount({ amount: 2500, currency: 'USD' }), 25);
  assert.equal(getSquareAmount({ amount: 2510 }), 25.1);
  assert.equal(getSquareAmount({ amount: 0 }), 0);
  assert.equal(getSquareAmount({}), 0);
  assert.equal(getSquareAmount(), 0);
});

test('a clean payment update reconciles as a payment', () => {
  // No refund data, so this must not be diverted away from payment
  // reconciliation or a real payment would never be marked Paid.
  assert.equal(isRefundSidePaymentUpdate({
    id: 'payment-1',
    status: 'COMPLETED',
    total_money: { amount: 2500 }
  }), false);

  assert.equal(isRefundSidePaymentUpdate({
    refunded_money: { amount: 0 },
    refund_ids: []
  }), false);

  assert.equal(isRefundSidePaymentUpdate({}), false);
});

test('refund-side payment updates are detected so they do not open false review rows', () => {
  // Square emits payment.updated alongside a refund. Treating those as fresh
  // payments created spurious Needs Review rows in Payment Review.
  assert.equal(isRefundSidePaymentUpdate({
    refunded_money: { amount: 2500 },
    status: 'COMPLETED'
  }), true);

  // A refund id with no amount yet still marks this as the refund side.
  assert.equal(isRefundSidePaymentUpdate({
    refund_ids: ['refund-1'],
    status: 'COMPLETED'
  }), true);

  // Partial refunds count too.
  assert.equal(isRefundSidePaymentUpdate({
    refunded_money: { amount: 500 },
    total_money: { amount: 2500 }
  }), true);
});

test('a malformed refund_ids value does not crash reconciliation', () => {
  assert.equal(isRefundSidePaymentUpdate({ refund_ids: null }), false);
  assert.equal(isRefundSidePaymentUpdate({ refund_ids: 'refund-1' }), false);
});
