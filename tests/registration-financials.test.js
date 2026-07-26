import assert from 'node:assert/strict';
import test from 'node:test';
import { getTotalPaidAmount } from '../src/utils/registrationFinancials.js';

test('sums amountPaid only for Paid registrations', () => {
  const total = getTotalPaidAmount([
    { amountPaid: 25, paymentStatus: 'Paid' },
    { amountPaid: 40, paymentStatus: 'Paid' },
    { amountPaid: 15, paymentStatus: 'Pending' },
    { amountPaid: 0, paymentStatus: 'No Charge' }
  ]);

  assert.equal(total, 65);
});

test('a refund removes its amount from the total even though amountPaid is preserved as history', () => {
  const total = getTotalPaidAmount([
    { amountPaid: 25, paymentStatus: 'Paid' },
    { amountPaid: 40, paymentStatus: 'Refunded' },
    { amountPaid: 30, paymentStatus: 'Refund Pending' }
  ]);

  assert.equal(total, 25);
});

test('waived and no-charge registrations never contribute, even with a stray amountPaid value', () => {
  assert.equal(getTotalPaidAmount([
    { amountPaid: 0, paymentStatus: 'Waived' },
    { amountPaid: 0, paymentStatus: 'No Charge' }
  ]), 0);
});

test('a missing amountPaid on an otherwise-Paid registration counts as zero', () => {
  assert.equal(getTotalPaidAmount([
    { paymentStatus: 'Paid' }
  ]), 0);
});

test('empty and default input never throws', () => {
  assert.equal(getTotalPaidAmount([]), 0);
  assert.equal(getTotalPaidAmount(), 0);
});

test('a registration missing entirely (null/undefined in the array) is skipped safely', () => {
  assert.equal(getTotalPaidAmount([
    null,
    undefined,
    { amountPaid: 10, paymentStatus: 'Paid' }
  ]), 10);
});
