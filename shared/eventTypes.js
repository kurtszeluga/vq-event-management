// Which event types belong to Programs, shared because the split is enforced
// in two places that must agree: the admin dashboard decides which tabs and
// which types an account sees, and /api/admin-manage-event decides what it may
// actually write. A copy in each would be a boundary that drifts.
//
// Programs is classes and lectures. Everything else an event can be -
// Workshop, Retreat, Other - stays under Events/Activities, and the listing
// types (Challenges, Business Listing, For Sale, Membership) have tabs of
// their own under the same Events permission.
export const PROGRAM_EVENT_TYPES = [
  'Class (Half Day)',
  'Class (Full Day)',
  'Lecture'
];

export function isProgramEventType(eventType) {
  return PROGRAM_EVENT_TYPES.includes(String(eventType || '').trim());
}
