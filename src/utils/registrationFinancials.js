// Money currently collected and kept for an event: amountPaid is preserved as
// a historical record even after a refund (see RegistrationPanel.jsx's
// normalizePaymentEdit), but paymentStatus moves off 'Paid' when that happens
// - so filtering on paymentStatus alone already nets out Refunded and Refund
// Pending amounts without needing to subtract anything.
export function getTotalPaidAmount(registrations = []) {
  return registrations
    .filter((registration) => registration?.paymentStatus === 'Paid')
    .reduce((total, registration) => total + Number(registration.amountPaid || 0), 0);
}
