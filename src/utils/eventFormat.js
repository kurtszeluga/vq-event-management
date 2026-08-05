// The listing field definitions live in shared/ so the GoDaddy feed API can
// serialize the same ones into its payload - see shared/eventListing.js.
export {
  LISTING_EVENT_TYPES,
  buildListingDetails,
  formatCurrency,
  formatListingDateTime,
  formatWebsiteLabel,
  getListingTitle,
  isListingEventType,
  normalizeWebsiteUrl
} from '../../shared/eventListing.js';

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

const MONTH_LABELS = [
  'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
  'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
];

// Month/day/year for the stacked date box on an event card, so a date can be
// scanned down a list rather than read out of the card body.
//
// Same plain-text-first discipline as formatEventDate above, and for the same
// reason: an ISO date-only string read through Date is UTC midnight, which in
// any timezone behind UTC lands on the day before. The GoDaddy embed carries
// its own copy of this because it is a standalone IIFE and cannot import from
// here - the two must stay in step, and a split exactly like this once had the
// feed rendering every date a day early while the app's page stayed correct.
//
// Returns null rather than a placeholder, so the caller decides whether an
// undated event shows a TBD box or no box at all.
export function getEventDateParts(dateValue) {
  if (!dateValue) {
    return null;
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateValue));

  if (isoMatch) {
    const month = MONTH_LABELS[Number(isoMatch[2]) - 1];

    return month
      ? { day: String(Number(isoMatch[3])), month, year: isoMatch[1] }
      : null;
  }

  const parsed = new Date(dateValue);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return {
    day: String(parsed.getDate()),
    month: MONTH_LABELS[parsed.getMonth()],
    year: String(parsed.getFullYear())
  };
}

// A retreat spans days, so it carries `endDate` alongside `date`. Every other
// type leaves endDate empty and formats exactly as it did before, which is why
// display sites can call this unconditionally instead of branching on type.
export function formatEventDateRange(event) {
  const startDate = event?.date || '';
  const endDate = event?.endDate || '';

  if (!endDate || endDate === startDate) {
    return formatEventDate(startDate);
  }

  if (!startDate) {
    return formatEventDate(endDate);
  }

  return `${formatEventDate(startDate)} - ${formatEventDate(endDate)}`;
}

export function formatDateOnly(dateValue) {
  if (!dateValue) {
    return 'Date TBD';
  }

  if (typeof dateValue?.toDate === 'function') {
    return dateValue.toDate().toLocaleDateString();
  }

  const datePart = String(dateValue).split('T')[0];

  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return formatEventDate(datePart);
  }

  const parsed = new Date(dateValue);

  if (Number.isNaN(parsed.getTime())) {
    return dateValue;
  }

  return parsed.toLocaleDateString();
}

export function getRegistrationStartDate(event) {
  if (!event || !['future', 'now'].includes(event.registrationMode)) {
    return '';
  }

  return event?.registrationOpenAt
    || event?.visibleFrom
    || event?.createdDate
    || '';
}

export function getRegistrationEndDate(event) {
  if (!event || !['future', 'now'].includes(event.registrationMode)) {
    return '';
  }

  return event?.registrationCloseAt
    || event?.date
    || '';
}

export function formatRegistrationDateRange(event) {
  const startDate = getRegistrationStartDate(event);
  const endDate = getRegistrationEndDate(event);

  if (!startDate && !endDate) {
    return 'Dates TBD';
  }

  if (!startDate) {
    return formatDateOnly(endDate);
  }

  if (!endDate) {
    return formatDateOnly(startDate);
  }

  return `Opens ${formatDateOnly(startDate)} · Closes ${formatDateOnly(endDate)}`;
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
