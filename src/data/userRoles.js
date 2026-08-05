export const USER_ROLES = ['Super User', 'Admin', 'General User'];

export const USER_STATUSES = ['Active', 'Inactive'];

export const MEMBERSHIP_STATUS_OPTIONS = ['Pending', 'Active', 'Inactive', 'Archived', 'Unknown'];

export const USER_PERMISSION_OPTIONS = [
  {
    key: 'manageEvents',
    label: 'Manage Events And Activities'
  },
  {
    key: 'viewRegistrations',
    label: 'View Registrations'
  },
  {
    key: 'managePayments',
    label: 'Manage Payments'
  },
  {
    key: 'addUsers',
    label: 'Add New Users'
  },
  {
    key: 'manageMembershipStatus',
    label: 'Manage Membership Status'
  },
  {
    key: 'registerOthers',
    label: 'Register Members On Their Behalf'
  },
  {
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
