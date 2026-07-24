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
