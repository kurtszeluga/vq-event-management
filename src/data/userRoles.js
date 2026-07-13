export const USER_ROLES = ['Super User', 'Admin', 'General User'];

export const USER_STATUSES = ['Active', 'Inactive'];

export const MEMBERSHIP_STATUS_OPTIONS = ['Active', 'Inactive', 'Archived', 'Unknown'];

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
  }
];

export const DEFAULT_USER_PERMISSIONS = USER_PERMISSION_OPTIONS.reduce(
  (permissions, option) => ({ ...permissions, [option.key]: false }),
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
