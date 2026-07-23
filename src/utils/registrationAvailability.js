export function getRegistrationAvailability(event, counts = {}) {
  if (event?.capacityUnlimited) {
    return {
      isFull: false,
      label: 'Unlimited',
      tone: 'open'
    };
  }

  const capacity = Number(event?.capacity || 0);

  if (!capacity) {
    return {
      isFull: false,
      label: 'Seats available',
      tone: 'open'
    };
  }

  const registeredCount = Number(counts.registered || 0)
    + Number(counts.pendingPayment || 0)
    + Number(counts.held || 0);

  if (registeredCount >= capacity) {
    const pendingPaymentCount = Number(counts.pendingPayment || 0);

    return {
      isFull: true,
      label: counts.held
        ? 'Seat on hold - waitlist available'
        : pendingPaymentCount
          ? 'Seat pending payment - waitlist available'
          : 'Full - waitlist available',
      tone: 'waitlist'
    };
  }

  return {
    isFull: false,
    label: 'Seats available',
    tone: 'open'
  };
}
