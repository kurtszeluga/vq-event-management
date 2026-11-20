import { describe, expect, it } from 'vitest';
import { normalizePaymentEdit } from '../../src/components/admin/RegistrationPanel.jsx';

// Reported: selecting Refunded on a registration did not force a comment and
// went straight through to the Square refund.
//
// The guard was there and read `if (!paymentNote)`. What it missed is that the
// edit form pre-fills the note box from the registration, and an online
// payment always carries "Paid online through Square." - so the field was
// never empty, the check never fired, and the refund was recorded against the
// payment's own note with the refund id appended. No who, no when, no why.

const PAID_ONLINE = {
  amountPaid: 25,
  paymentMethod: 'Online',
  paymentNote: 'Paid online through Square.',
  paymentStatus: 'Paid'
};

function refundWith(paymentNote, registration = PAID_ONLINE) {
  return normalizePaymentEdit(registration, {
    amountPaid: String(registration.amountPaid),
    paymentMethod: registration.paymentMethod,
    paymentNote,
    paymentStatus: 'Refunded'
  });
}

describe('refunding an online payment', () => {
  it('refuses the note the form arrived with', () => {
    // The exact reported case.
    expect(refundWith('Paid online through Square.').error).toMatch(/Enter refund details/);
  });

  it('refuses an empty note', () => {
    expect(refundWith('').error).toMatch(/Enter refund details/);
    expect(refundWith('   ').error).toMatch(/Enter refund details/);
  });

  it('refuses the same note with only whitespace changed', () => {
    expect(refundWith('  Paid online through Square.  ').error).toMatch(/Enter refund details/);
  });

  it('accepts a real explanation', () => {
    const result = refundWith('Refunded 20 Nov, approved by the treasurer - member withdrew.');

    expect(result.error).toBeUndefined();
    expect(result.payment.paymentStatus).toBe('Refunded');
    expect(result.payment.paymentNote).toBe(
      'Refunded 20 Nov, approved by the treasurer - member withdrew.'
    );
    expect(result.payment.amountPaid).toBe(25);
  });
});

describe('refunding a cash or check payment', () => {
  // The second Refunded branch carried the identical check and the identical
  // flaw, so it gets the identical rule.
  const PAID_CASH = {
    amountPaid: 15,
    paymentMethod: 'Cash',
    paymentNote: 'Cash taken at the door.',
    paymentStatus: 'Paid'
  };

  it('refuses the note it arrived with', () => {
    expect(refundWith('Cash taken at the door.', PAID_CASH).error)
      .toMatch(/Enter refund details/);
  });

  it('accepts a real explanation', () => {
    expect(refundWith('Cash returned 20 Nov by the treasurer.', PAID_CASH).error)
      .toBeUndefined();
  });
});

describe('a registration with no note of its own', () => {
  it('still requires one for a refund', () => {
    const noNote = { amountPaid: 10, paymentMethod: 'Check', paymentStatus: 'Paid' };

    expect(refundWith('', noNote).error).toMatch(/Enter refund details/);
    expect(refundWith('Cheque voided 20 Nov.', noNote).error).toBeUndefined();
  });
});
