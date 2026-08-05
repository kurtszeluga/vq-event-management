// 'Imported' means the member came from a membership CSV, so dues are treated
// as paid without an amount or method ever having been recorded. Before it
// existed the import wrote 'Paid' with a zero amount, which the normaliser
// below refuses to re-save - so every imported profile was unopenable for
// editing until an amount was invented for it.
//
// Kept out of UserControlPanel so it can be tested without standing the whole
// admin dashboard up, and so the component file keeps exporting only a
// component.
export const MEMBERSHIP_PAYMENT_STATUSES = ['Pending', 'Paid', 'Imported', 'Waived', 'Refunded'];

export function normalizeMembershipPayment(form) {
  const paymentStatus = MEMBERSHIP_PAYMENT_STATUSES.includes(form.membershipPaymentStatus)
    ? form.membershipPaymentStatus
    : 'Pending';
  const paymentNote = String(form.membershipPaymentNote || '').trim();

  if (paymentStatus === 'Pending') {
    return {
      amount: 0,
      method: '',
      note: paymentNote,
      status: 'Pending'
    };
  }

  if (paymentStatus === 'Waived') {
    return {
      amount: 0,
      method: 'Comped',
      note: paymentNote,
      status: 'Waived'
    };
  }

  // No amount to demand: the CSV carries who is a member in good standing, not
  // what anyone paid.
  if (paymentStatus === 'Imported') {
    return {
      amount: 0,
      method: '',
      note: paymentNote,
      status: 'Imported'
    };
  }

  if (paymentStatus === 'Refunded') {
    if (!paymentNote) {
      throw new Error('Enter refund details: when, who approved it, and why.');
    }

    return {
      amount: Number(form.membershipPaymentAmount || 0),
      method: form.membershipPaymentMethod || '',
      note: paymentNote,
      status: 'Refunded'
    };
  }

  const method = ['Cash', 'Check'].includes(form.membershipPaymentMethod)
    ? form.membershipPaymentMethod
    : 'Cash';
  const amount = Number(form.membershipPaymentAmount || 0);

  if (amount <= 0) {
    throw new Error('Enter the amount received for a membership cash or check payment.');
  }

  return {
    amount,
    method,
    note: paymentNote,
    status: 'Paid'
  };
}
