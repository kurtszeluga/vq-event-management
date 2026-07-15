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

  const registeredCount = Number(counts.registered || 0);

  if (registeredCount >= capacity) {
    return {
      isFull: true,
      label: 'Full - waitlist available',
      tone: 'waitlist'
    };
  }

  return {
    isFull: false,
    label: 'Seats available',
    tone: 'open'
  };
}
