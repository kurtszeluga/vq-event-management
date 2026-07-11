export function formatCurrency(value) {
  const numberValue = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency'
  }).format(numberValue);
}

export function formatEventDate(dateValue) {
  if (!dateValue) {
    return 'Date TBD';
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
    const [year, month, day] = dateValue.split('-');
    return `${month}/${day}/${year}`;
  }

  return dateValue;
}

export function formatTimeRange(startTime, endTime) {
  if (!startTime || !endTime) {
    return 'Time TBD';
  }

  return `${formatClockTime(startTime)} - ${formatClockTime(endTime)}`;
}

export function formatClockTime(value) {
  if (!value) {
    return '';
  }

  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  const suffix = hour >= 12 ? 'p.m.' : 'a.m.';
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minuteText} ${suffix}`;
}

export function isEventVisible(event) {
  if (event.status !== 'Published') {
    return false;
  }

  const now = Date.now();
  const visibleFrom = event.visibleFrom ? Date.parse(event.visibleFrom) : null;
  const visibleUntil = event.visibleUntil ? Date.parse(event.visibleUntil) : null;

  if (visibleFrom && visibleFrom > now) {
    return false;
  }

  if (visibleUntil && visibleUntil < now) {
    return false;
  }

  return true;
}
