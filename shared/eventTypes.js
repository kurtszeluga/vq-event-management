// Which event types belong to which admin permission, shared because the
// split is enforced in two places that must agree: the admin dashboard
// decides which tabs and which types an account sees, and
// /api/admin-manage-event decides what it may actually write. A copy in each
// would be a boundary that drifts.
//
// Programs is classes and lectures. Challenges is its own permission as of
// 2026-11-21. Everything else an event can be - Workshop, Retreat, Other -
// plus the remaining listing types (Business Listing, For Sale, Membership)
// stays under Manage Events And Activities.
export const PROGRAM_EVENT_TYPES = [
  'Class (Half Day)',
  'Class (Full Day)',
  'Lecture'
];

// A list of one, deliberately: it is read the same way PROGRAM_EVENT_TYPES is,
// so a second challenge-like type later lands in the same scope by being added
// here rather than by a second string comparison appearing in five files.
export const CHALLENGE_EVENT_TYPES = ['Challenges'];

export function isProgramEventType(eventType) {
  return PROGRAM_EVENT_TYPES.includes(String(eventType || '').trim());
}

export function isChallengeEventType(eventType) {
  return CHALLENGE_EVENT_TYPES.includes(String(eventType || '').trim());
}

// The permission that owns a type. Every type resolves to exactly one, so a
// type added later falls into Manage Events And Activities unless it is named
// in one of the lists above - which is the safe default, since that is the
// permission an events admin already holds.
export function getEventTypePermissionKey(eventType) {
  if (isProgramEventType(eventType)) {
    return 'managePrograms';
  }

  if (isChallengeEventType(eventType)) {
    return 'manageChallenges';
  }

  return 'manageEvents';
}

// Which types an account may create or edit. Used by the admin form to decide
// what the Event Type dropdown offers; the server decides the same question
// from the same lists in getEventScopeError().
export function getManageableEventTypes(eventTypes, permissions = {}) {
  return eventTypes.filter(
    (eventType) => permissions[getEventTypePermissionKey(eventType)] === true
  );
}
