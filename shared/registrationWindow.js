// Registration window rules, shared verbatim by the browser and the Vercel
// functions. This directory exists because `api/_lib` cannot be imported from
// `src/` (it pulls in `node:crypto`), and a split copy of these rules is how
// registration dates end up being displayed but not enforced. Keep this module
// dependency-free so both runtimes can load it.

// The guild is in Loudon, TN. Admins type registration dates into
// `datetime-local` inputs, which produce naive 'YYYY-MM-DDTHH:mm' strings with
// no timezone. Those strings mean wall-clock time at the guild, so both sides
// must resolve them against this zone rather than against whatever zone the
// runtime happens to be in: the browser is usually Eastern, but Vercel runs in
// UTC, and `Date.parse` on a naive string uses the *local* zone. Without
// pinning, the same stored value closes registration four hours early on the
// server than it appears to on the member's screen.
export const GUILD_TIME_ZONE = 'America/New_York';

// The two `registrationMode` values that carry a date window. 'none' (and any
// unset value) means the event does not take registrations at all.
export const REGISTRATION_WINDOW_MODES = ['future', 'now'];

// Listings, not events - they never accept registrations regardless of dates.
export const NON_REGISTRABLE_EVENT_TYPES = ['Business Listing', 'For Sale'];

// Go-live transition only. An event carrying `externalRegistrationUrl` is still
// run by the guild's previous registration system, so the Register control
// points there instead of into this app. Delete this and its callers once the
// last such event has passed.
//
// Only http(s) is accepted. The value becomes a link members click, so a
// javascript: or data: URL typed into the admin form would be a script
// injection route through a field that exists to hold someone else's address.
export function getExternalRegistrationUrl(event) {
  const value = String(event?.externalRegistrationUrl || '').trim();

  if (!/^https?:\/\/\S+$/i.test(value)) {
    return '';
  }

  return value;
}

const NAIVE_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/;

// Offset, in ms, that must be added to a UTC instant to get the given zone's
// wall-clock reading of it. East of UTC is positive.
function zoneOffsetMs(instantMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(new Date(instantMs));

  const read = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      read[part.type] = part.value;
    }
  }

  // Some ICU builds render midnight as hour 24.
  const hour = Number(read.hour) === 24 ? 0 : Number(read.hour);

  const wallClockAsUtc = Date.UTC(
    Number(read.year),
    Number(read.month) - 1,
    Number(read.day),
    hour,
    Number(read.minute),
    Number(read.second)
  );

  return wallClockAsUtc - instantMs;
}

// Resolves a naive 'YYYY-MM-DDTHH:mm' string to a UTC timestamp, reading it as
// wall-clock time in `timeZone`. Returns null for anything unparseable so
// callers can distinguish "no date set" from "date set to garbage".
//
// Strings that already carry a zone (a trailing Z or +hh:mm) are handed to
// Date.parse untouched, since they are unambiguous.
export function parseGuildDateTime(value, timeZone = GUILD_TIME_ZONE) {
  if (value === null || value === undefined) {
    return null;
  }

  // Firestore Timestamp
  if (typeof value?.toDate === 'function') {
    const asDate = value.toDate();
    return Number.isNaN(asDate.getTime()) ? null : asDate.getTime();
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const match = NAIVE_DATE_TIME.exec(text);

  if (!match) {
    const parsed = Date.parse(text);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;

  const naiveAsUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );

  // Two passes: the first offset is measured at the wrong instant whenever the
  // guess and the answer fall on opposite sides of a DST transition, so it is
  // re-measured at the corrected instant. Times inside the skipped or repeated
  // hour of a transition resolve to one of the two plausible instants; that is
  // an hour's slack once a year on a date an admin picked by hand, which is not
  // worth a timezone dependency to close.
  let resolved = naiveAsUtc - zoneOffsetMs(naiveAsUtc, timeZone);
  resolved = naiveAsUtc - zoneOffsetMs(resolved, timeZone);

  return resolved;
}

// The single source of truth for "can someone register right now".
//
// Deliberately ignores the stored `registrationOpen` boolean. That field is
// written as `registrationMode === 'now'` at save time and never revisited, so
// trusting it means a 'future' event never opens and a 'now' event never
// closes. The dates are what the admin configured and what the app shows
// members, so the dates decide.
//
// Returns a state rather than a boolean so callers can explain themselves:
//   'not-registrable' - a Business Listing or For Sale item
//   'disabled'        - registration was never enabled for this event
//   'not-yet-open'    - configured to open later
//   'closed'          - the window has passed
//   'open'            - registration is live
export function getRegistrationWindowState(event, options = {}) {
  const { now = Date.now(), timeZone = GUILD_TIME_ZONE } = options;

  if (!event) {
    return { state: 'disabled', opensAt: null, closesAt: null };
  }

  if (NON_REGISTRABLE_EVENT_TYPES.includes(event.eventType)) {
    return { state: 'not-registrable', opensAt: null, closesAt: null };
  }

  if (!REGISTRATION_WINDOW_MODES.includes(event.registrationMode)) {
    return { state: 'disabled', opensAt: null, closesAt: null };
  }

  const opensAt = parseGuildDateTime(event.registrationOpenAt, timeZone);
  const closesAt = parseGuildDateTime(event.registrationCloseAt, timeZone);

  // A 'future' event with no usable open date has nothing to open it, so it
  // stays shut rather than defaulting open. This preserves the old behaviour
  // for legacy or malformed records instead of silently opening them.
  if (opensAt === null && event.registrationMode === 'future') {
    return { state: 'disabled', opensAt, closesAt };
  }

  if (opensAt !== null && now < opensAt) {
    return { state: 'not-yet-open', opensAt, closesAt };
  }

  if (closesAt !== null && now > closesAt) {
    return { state: 'closed', opensAt, closesAt };
  }

  return { state: 'open', opensAt, closesAt };
}

export function isRegistrationWindowOpen(event, options = {}) {
  return getRegistrationWindowState(event, options).state === 'open';
}

// True when the close date precedes the open date. Surfaced so EventForm can
// reject the range on save; without it the two fallback chains in
// eventFormat.js can render "Opens 07/19 - Closes 07/13" to members.
export function isRegistrationWindowInverted(event, options = {}) {
  const { timeZone = GUILD_TIME_ZONE } = options;
  const opensAt = parseGuildDateTime(event?.registrationOpenAt, timeZone);
  const closesAt = parseGuildDateTime(event?.registrationCloseAt, timeZone);

  return opensAt !== null && closesAt !== null && closesAt <= opensAt;
}
