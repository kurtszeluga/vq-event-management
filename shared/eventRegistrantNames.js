// Who appears on the member-visible "who else is coming" list, shared verbatim
// by the browser and the Vercel functions so the two cannot disagree about it.
// Keep this module dependency-free so both runtimes can load it.
//
// The list is names ONLY. The registration documents behind it carry email,
// phone, amounts paid and Square transaction ids, and Firestore rules cannot
// project fields - which is why this derived collection exists at all rather
// than the registrations simply being made readable.

// Registered and Pending Payment are one undifferentiated list on purpose.
// Both hold a seat, and whether someone has settled up yet is financial
// information that other members have no business seeing.
export const REGISTRANT_NAME_STATUSES = ['Registered', 'Pending Payment'];

// Waitlisted is deliberately absent: a waitlist position is not attendance, and
// publishing one tells everybody who missed out.
export function isVisibleRegistrant(registration) {
  return REGISTRANT_NAME_STATUSES.includes(registration?.status);
}

// A cancelled registration drops out simply by not matching above, so the
// rebuild below is what removes it - there is no separate deletion path.
export function buildRegistrantNames(registrations = []) {
  const seen = new Set();
  const names = [];

  registrations.filter(isVisibleRegistrant).forEach((registration) => {
    const name = formatRegistrantName(registration);

    if (!name) {
      return;
    }

    const key = name.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  });

  // Sorted here rather than at render time so every reader sees the same order
  // and the stored document does not churn on unrelated writes.
  return names.sort((first, second) => first.localeCompare(second));
}

// Falls back through the same chain the admin list uses. Never the email: an
// address is not a name, and this list is not allowed to carry one.
function formatRegistrantName(registration) {
  const first = String(registration?.registrantFirstName || '').trim();
  const last = String(registration?.registrantLastName || '').trim();
  const combined = [first, last].filter(Boolean).join(' ');

  return combined || String(registration?.name || '').trim();
}
