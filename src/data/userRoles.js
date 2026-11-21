export const USER_ROLES = ['Super User', 'Admin', 'General User'];

export const USER_STATUSES = ['Active', 'Inactive'];

export const MEMBERSHIP_STATUS_OPTIONS = ['Pending', 'Active', 'Inactive', 'Archived', 'Unknown'];

// Each description says what the permission actually opens, taken from where
// the key is read rather than from what its label sounds like. The labels on
// their own mislead: "Manage Events And Activities" reads as one tab and is in
// fact several, because Business Listings, For Sale and Membership are all
// event TYPES in the same collection, and Archive is archived events. That
// surprised the person granting it, which is what these are here to prevent.
export const USER_PERMISSION_OPTIONS = [
  {
    description: 'Opens the Programs tab only: half-day classes, full-day classes and '
      + 'lectures. Grant this alone to someone who books the program calendar and '
      + 'nothing else.',
    key: 'managePrograms',
    label: 'Manage Programs'
  },
  {
    description: 'Opens everything else events: the Workshops tab and the '
      + 'Retreats/Other Events tab, plus Business Listings, For Sale, Membership and '
      + 'Archive. It does NOT include Programs or Challenges, which each have a '
      + 'permission of their own.',
    key: 'manageEvents',
    label: 'Manage Events And Activities'
  },
  {
    description: 'Opens the Challenges tab only: the guild challenges members quilt to, '
      + 'with their posting window and their challenge PDF. Grant this alone to someone '
      + 'who runs the challenges and nothing else.',
    key: 'manageChallenges',
    label: 'Manage Challenges'
  },
  {
    description: 'Opens the Registrations tab and Payment Review: who has signed up for '
      + 'what, their payment status, and the printable registration lists.',
    key: 'viewRegistrations',
    label: 'View Registrations'
  },
  {
    description: 'Allows reading Square payment and refund records. On its own it opens '
      + 'no tab - Payment Review sits behind View Registrations - so grant it alongside '
      + 'that one rather than instead of it.',
    key: 'managePayments',
    label: 'Manage Payments'
  },
  {
    description: 'Opens the User Controls tab, to add profiles and edit existing ones. '
      + 'An Admin can only edit General Users; only a Super User can edit another Admin.',
    key: 'addUsers',
    label: 'Add New Users'
  },
  {
    description: 'Allows approving and changing a member\'s Guild membership status, and '
      + 'shows the count of profiles waiting for membership review.',
    key: 'manageMembershipStatus',
    label: 'Manage Membership Status'
  },
  {
    description: 'Allows signing a member up for an event on their behalf, including '
      + 'recording a cash or check payment taken in person.',
    key: 'registerOthers',
    label: 'Register Members On Their Behalf'
  },
  {
    description: 'Allows working a full event\'s waiting list - offering a freed seat to '
      + 'the next person, and passing an offer on when it is declined.',
    key: 'manageWaitlist',
    label: 'Manage Event Waitlists'
  }
];

export const DEFAULT_USER_PERMISSIONS = USER_PERMISSION_OPTIONS.reduce(
  (permissions, option) => ({ ...permissions, [option.key]: false }),
  {}
);

// What a Super User's stored map should say. Their authority never depends on
// it - hasPermission() below, the same helper in firestore.rules, and the API
// all short-circuit on the role - but the map is what the profile screen and
// the user list read back, so leaving it false made a Super User look stripped
// of everything it can actually do.
export const ALL_USER_PERMISSIONS = USER_PERMISSION_OPTIONS.reduce(
  (permissions, option) => ({ ...permissions, [option.key]: true }),
  {}
);

export function normalizePermissions(permissions = {}) {
  return USER_PERMISSION_OPTIONS.reduce(
    (normalized, option) => ({
      ...normalized,
      [option.key]: Boolean(permissions[option.key])
    }),
    {}
  );
}

export function isSuperUser(profile) {
  return profile?.role === 'Super User' && profile?.status === 'Active';
}

export function hasAdminAccess(profile) {
  return (
    profile?.status === 'Active' &&
    (profile?.role === 'Super User' || profile?.role === 'Admin')
  );
}

export function hasPermission(profile, permissionKey) {
  if (isSuperUser(profile)) {
    return true;
  }

  return (
    profile?.role === 'Admin' &&
    profile?.status === 'Active' &&
    Boolean(profile?.permissions?.[permissionKey])
  );
}
