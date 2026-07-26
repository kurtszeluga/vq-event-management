// Fail closed: a missing document, a missing field, or a malformed value all
// behave like the setting is on. This mirrors current production behaviour -
// membership status has always been enforced - so wiring this read in changes
// nothing unless an admin explicitly turns it off.
const DEFAULT_REQUIRE_MEMBERSHIP_CHECK = true;

export function resolveRequireMembershipCheck(settingsData) {
  const value = settingsData?.requireMembershipCheck;
  return typeof value === 'boolean' ? value : DEFAULT_REQUIRE_MEMBERSHIP_CHECK;
}

export async function getRequireMembershipCheck(db) {
  const snapshot = await db.collection('appSettings').doc('membership').get();
  return resolveRequireMembershipCheck(snapshot.exists ? snapshot.data() : null);
}
