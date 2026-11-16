// Membership dues: the one place that answers "what does this cost today".
//
// Every other event type has a flat `cost`. A Membership event does not - the
// guild charges one amount for part of the year and another for the rest, so
// the price depends on the day the member signs up rather than on anything
// stored against the event. Both runtimes need the same answer (the browser to
// show a price, the Vercel functions to charge one), which is why this lives in
// `shared/` next to registrationWindow.js and stays dependency-free apart from
// the guild timezone.
//
// The rule is deliberately expressed as two START dates rather than two
// ranges. Two starts cannot overlap, cannot leave a gap, and cannot be typed
// into a contradiction - the year is a circle cut at two points, and every day
// is on exactly one arc. A pair of ranges can say 25 dollars and 50 dollars for
// the same day, and then the display and the charge disagree.
import { GUILD_TIME_ZONE } from './registrationWindow.js';

export const MEMBERSHIP_EVENT_TYPE = 'Membership';

// Jul 1 through Sep 30 is 25 dollars; Oct 1 through Jun 30 is 50 dollars.
// These are only the defaults a new Membership event opens with - the live
// values come from Configuration (appSettings/paymentSettings) and are copied
// onto the event at save, the same way default times and locations are.
export const DEFAULT_MEMBERSHIP_FEE_SCHEDULE = {
  earlyFee: 25,
  earlyStart: '07-01',
  regularFee: 50,
  regularStart: '10-01'
};

const MONTH_DAY = /^(\d{2})-(\d{2})$/;

export function isMembershipEvent(event) {
  return event?.eventType === MEMBERSHIP_EVENT_TYPE;
}

// 'MM-DD' as a sortable integer, so two points on the year can be compared
// without building Date objects. Returns null for anything unparseable rather
// than guessing, so callers fall back to the defaults instead of pricing an
// event off a typo.
function monthDayValue(value) {
  const match = MONTH_DAY.exec(String(value || '').trim());

  if (!match) {
    return null;
  }

  const month = Number(match[1]);
  const day = Number(match[2]);

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  return month * 100 + day;
}

// Today's month and day as the guild reads them, not as the server's clock
// does. Vercel runs in UTC, so between 7pm and midnight Eastern the server is
// already on tomorrow's date - on Jun 30 that is the difference between a 50
// dollar charge and a 25 dollar one.
function guildMonthDayValue(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).formatToParts(date);
  const read = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      read[part.type] = part.value;
    }
  }

  return Number(read.month) * 100 + Number(read.day);
}

// Fills in anything missing or malformed from the defaults, so a half-written
// schedule prices at the default rather than at zero.
export function normalizeMembershipFeeSchedule(schedule) {
  const earlyFee = Number(schedule?.earlyFee);
  const regularFee = Number(schedule?.regularFee);

  return {
    earlyFee: Number.isFinite(earlyFee) && earlyFee >= 0
      ? earlyFee
      : DEFAULT_MEMBERSHIP_FEE_SCHEDULE.earlyFee,
    earlyStart: monthDayValue(schedule?.earlyStart) === null
      ? DEFAULT_MEMBERSHIP_FEE_SCHEDULE.earlyStart
      : String(schedule.earlyStart).trim(),
    regularFee: Number.isFinite(regularFee) && regularFee >= 0
      ? regularFee
      : DEFAULT_MEMBERSHIP_FEE_SCHEDULE.regularFee,
    regularStart: monthDayValue(schedule?.regularStart) === null
      ? DEFAULT_MEMBERSHIP_FEE_SCHEDULE.regularStart
      : String(schedule.regularStart).trim()
  };
}

// Which of the two rates applies on a given day: 'early' or 'regular'.
//
// Each start date is inclusive of its own rate. With the defaults, Jul 1 is the
// first early day and Sep 30 the last; Oct 1 is the first regular day and
// Jun 30 the last. The second branch is the wrap-around case - the regular
// window spans New Year, so its days are the ones at or after Oct 1 OR before
// Jul 1, which is why it cannot be written as a single comparison.
export function getMembershipRateName(schedule, options = {}) {
  const { now = Date.now(), timeZone = GUILD_TIME_ZONE } = options;
  const normalized = normalizeMembershipFeeSchedule(schedule);
  const early = monthDayValue(normalized.earlyStart);
  const regular = monthDayValue(normalized.regularStart);
  const today = guildMonthDayValue(new Date(now), timeZone);

  // Both rates starting on the same day is a configuration mistake with no
  // sensible reading. Charge the higher-priced regular rate rather than
  // picking the cheaper one off an ambiguity.
  if (early === regular) {
    return 'regular';
  }

  if (early < regular) {
    return today >= early && today < regular ? 'early' : 'regular';
  }

  return today >= early || today < regular ? 'early' : 'regular';
}

export function getMembershipFeeOn(schedule, options = {}) {
  const normalized = normalizeMembershipFeeSchedule(schedule);

  return getMembershipRateName(normalized, options) === 'early'
    ? normalized.earlyFee
    : normalized.regularFee;
}

// The single entry point every price display and both server-side charge
// calculations go through. A non-Membership event returns its stored `cost`
// untouched, so adding this to an existing render site cannot change what that
// site shows for any type that already worked.
export function getEventCostOn(event, options = {}) {
  if (!isMembershipEvent(event)) {
    return Number(event?.cost || 0);
  }

  return getMembershipFeeOn(event?.membershipFeeSchedule, options);
}

// The paymentSettings document spells the schedule out flat (membershipEarlyFee
// and friends) because firestore.rules can only type-check top-level keys with
// hasOnly. This module works in the nested shape, so the two spellings are
// converted here rather than in each caller.
//
// Lives here rather than beside the Firestore reads so that a component
// holding a settings object can resolve it without importing the service layer
// at all - the schedule is a value, not a query.
export function readMembershipFeeSchedule(settings = {}) {
  return normalizeMembershipFeeSchedule({
    earlyFee: settings.membershipEarlyFee,
    earlyStart: settings.membershipEarlyStart,
    regularFee: settings.membershipRegularFee,
    regularStart: settings.membershipRegularStart
  });
}

export function toMembershipDuesSettings(settings = {}) {
  const schedule = readMembershipFeeSchedule(settings);

  return {
    membershipEarlyFee: schedule.earlyFee,
    membershipEarlyStart: schedule.earlyStart,
    membershipRegularFee: schedule.regularFee,
    membershipRegularStart: schedule.regularStart
  };
}

// 'MM-DD' as a month name and day, for the admin explaining the schedule back
// to itself ("Jul 1"). Year-free on purpose: the schedule repeats.
const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

export function formatMonthDay(value) {
  const match = MONTH_DAY.exec(String(value || '').trim());

  if (!match) {
    return '';
  }

  return `${MONTH_NAMES[Number(match[1]) - 1]} ${Number(match[2])}`;
}

// The day before a start date, so a window can be described by its end as well
// as its beginning ("Jul 1 - Sep 30"). Uses a leap year so Feb 29 survives.
export function getDayBefore(value) {
  const match = MONTH_DAY.exec(String(value || '').trim());

  if (!match) {
    return '';
  }

  const date = new Date(Date.UTC(2024, Number(match[1]) - 1, Number(match[2])));

  date.setUTCDate(date.getUTCDate() - 1);

  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
