// Profile tags, shared because the client, the server and the Firestore rules
// all have to agree on exactly one thing: whether a profile is a service
// account.
//
// There used to be two tags, vqBooking and vqHosting, and nothing anywhere
// branched on either - they were display-only, and a read of production found
// a single profile carrying one. They are gone rather than kept alongside,
// because a list of tags where only one means anything invites the other kind.
//
// A service account is a standing role mailbox - programs@, workshops@ - that
// runs part of the guild rather than belonging to a person. The whole point of
// marking it is that the annual membership refresh must not touch it: that
// sweep marks every unmatched profile Inactive, and an Inactive membership
// demotes an Admin to General User with its permissions cleared. A role
// account would be shut down every January.
export const SERVICE_ACCOUNT_TAG = 'serviceAccount';

export const PROFILE_TAGS = [SERVICE_ACCOUNT_TAG];

export function normalizeProfileTags(profileTags = []) {
  return Array.isArray(profileTags)
    ? profileTags.filter((tag) => PROFILE_TAGS.includes(tag))
    : [];
}

export function isServiceAccount(profile) {
  return normalizeProfileTags(profile?.profileTags).includes(SERVICE_ACCOUNT_TAG);
}

// The three fields a service account's state is pinned to, applied by every
// writer rather than trusted to each one. Active membership because an
// Inactive one demotes an Admin and clears its permissions; Active profile for
// the same reason; and Waived dues so a mailbox never sits in the unpaid list
// waiting for money nobody will take.
export function applyServiceAccountLock(profile, payload) {
  if (!isServiceAccount(profile)) {
    return payload;
  }

  return {
    ...payload,
    membershipPaymentStatus: 'Waived',
    membershipStatus: 'Active',
    status: 'Active'
  };
}
