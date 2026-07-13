import { Fragment, useCallback, useEffect, useState } from 'react';
import { PROFILE_TAG_OPTIONS, normalizeProfileTags } from '../../data/profileTags.js';
import { US_STATES } from '../../data/usStates.js';
import {
  DEFAULT_USER_PERMISSIONS,
  USER_PERMISSION_OPTIONS,
  MEMBERSHIP_STATUS_OPTIONS,
  USER_ROLES,
  USER_STATUSES,
  normalizePermissions
} from '../../data/userRoles.js';
import {
  createUserByAdmin,
  archiveUserProfile,
  reactivateUserProfile,
  subscribeToUsers,
  updateUserPasswordByAdmin,
  updateUserProfile
} from '../../services/userService.js';
import {
  buildDisplayName,
  buildBillingAddress,
  formatPhoneNumber,
  getProfileFirstName,
  getProfileLastName,
  toTitleCase
} from '../../utils/profileFormat.js';

const MEMBERSHIP_FILTERS = ['All', 'Active', 'Inactive', 'Archived', 'Unknown'];
const QUICK_FILTERS = [
  { key: 'all', label: 'All Profiles' },
  { key: 'admins', label: 'Admins' },
  { key: 'archived', label: 'Archived' }
];

function UserControlPanel({ canManageAdminUsers = false, currentUserProfile }) {
  const [detailsUserId, setDetailsUserId] = useState('');
  const [editingUserId, setEditingUserId] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [membershipFilter, setMembershipFilter] = useState('All');
  const [quickFilter, setQuickFilter] = useState('all');
  const [savingUserId, setSavingUserId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'lastName', direction: 'asc' });
  const [successMessage, setSuccessMessage] = useState('');
  const [users, setUsers] = useState([]);
  const canEditMembershipStatus =
    canManageAdminUsers || Boolean(currentUserProfile?.permissions?.manageMembershipStatus);

  useEffect(() => {
    const unsubscribe = subscribeToUsers(
      (snapshot) => {
        setUsers(
          snapshot.docs
            .map((userDoc) => ({ id: userDoc.id, ...userDoc.data() }))
            .sort((firstUser, secondUser) =>
              (firstUser.name || firstUser.email || '').localeCompare(
                secondUser.name || secondUser.email || ''
              )
            )
        );
        setError('');
        setLoadingUsers(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoadingUsers(false);
      },
      { includeAdminProfiles: canManageAdminUsers }
    );

    return unsubscribe;
  }, [canManageAdminUsers]);

  const filteredUsers = getFilteredUsers(users, quickFilter, membershipFilter);
  const searchedUsers = searchUsers(filteredUsers, searchTerm);

  const startAddUser = useCallback(() => {
    setEditingUserId('new');
    setSuccessMessage('');
    setForm({
      billingAddress: {
        city: '',
        country: 'United States',
        postalCode: '',
        state: '',
        street: ''
      },
      email: '',
      firstName: '',
      lastName: '',
      permissions: DEFAULT_USER_PERMISSIONS,
      phone: '',
      profileTags: [],
      role: 'General User',
      status: 'Active',
      temporaryPassword: '',
      userId: ''
    });
  }, []);

  function startEdit(user) {
    const billingAddress = user.billingAddress || {};

    setEditingUserId(user.id);
    setSuccessMessage('');
    setForm({
      billingAddress: {
        city: billingAddress.city || '',
        country: billingAddress.country || 'United States',
        postalCode: billingAddress.postalCode || '',
        state: billingAddress.state || '',
        street: billingAddress.street || ''
      },
      email: user.email || '',
      firstName: getProfileFirstName(user),
      lastName: getProfileLastName(user),
      membershipStatus: user.membershipStatus || 'Unknown',
      permissions: normalizePermissions(user.permissions),
      phone: formatPhoneNumber(user.phone || ''),
      profileTags: normalizeProfileTags(user.profileTags),
      role: user.role || 'General User',
      status: user.role === 'Super User' ? 'Active' : user.status || 'Active',
      temporaryPassword: '',
      userId: user.userId || user.id
    });
  }

  function updateFormField(name, value) {
    setSuccessMessage('');
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateRole(role) {
    setSuccessMessage('');
    setForm((current) => ({
      ...current,
      permissions: role === 'Admin' ? normalizePermissions(current.permissions) : DEFAULT_USER_PERMISSIONS,
      role,
      status: role === 'Super User' ? 'Active' : current.status
    }));
  }

  function updatePermission(permissionKey, value) {
    setSuccessMessage('');
    setForm((current) => ({
      ...current,
      permissions: {
        ...current.permissions,
        [permissionKey]: value
      }
    }));
  }

  function updateProfileTag(tagKey, value) {
    setSuccessMessage('');
    setForm((current) => {
      const currentTags = normalizeProfileTags(current.profileTags);

      return {
        ...current,
        profileTags: value
          ? [...new Set([...currentTags, tagKey])]
          : currentTags.filter((tag) => tag !== tagKey)
      };
    });
  }

  function updateBillingAddressField(name, value) {
    setSuccessMessage('');
    setForm((current) => ({
      ...current,
      billingAddress: {
        ...current.billingAddress,
        [name]: value
      }
    }));
  }

  async function handleSave(user) {
    setError('');
    setSuccessMessage('');
    setSavingUserId(user.id);

    try {
      if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim()) {
        throw new Error('First name, last name, and email are required.');
      }

      if (form.temporaryPassword && form.temporaryPassword.length < 8) {
        throw new Error('Temporary password must be at least 8 characters.');
      }

      if (!canManageAdminUsers && form.role !== 'General User') {
        throw new Error('Admins can only update General User profiles.');
      }

      const normalizedPermissions = normalizePermissions(form.permissions);
      const formattedFirstName = toTitleCase(form.firstName);
      const formattedLastName = toTitleCase(form.lastName);
      const displayName = buildDisplayName(formattedFirstName, formattedLastName);

      if (
        canManageAdminUsers &&
        form.role === 'Admin' &&
        !hasSelectedAdminPermission(normalizedPermissions)
      ) {
        throw new Error('Select at least one admin permission before saving an Admin profile.');
      }

      const payload = {
        billingAddress: buildBillingAddress(form.billingAddress),
        email: form.email.trim(),
        firstName: formattedFirstName,
        lastName: formattedLastName,
        name: displayName,
        permissions:
          canManageAdminUsers && form.role === 'Admin'
            ? normalizedPermissions
            : DEFAULT_USER_PERMISSIONS,
        phone: formatPhoneNumber(form.phone),
        profileTags: canManageAdminUsers
          ? normalizeProfileTags(form.profileTags)
          : normalizeProfileTags(user.profileTags),
        membershipStatus:
          canEditMembershipStatus && user.id !== 'new' && user.role !== 'Super User'
            ? form.membershipStatus || 'Unknown'
            : user.membershipStatus || 'Unknown',
        role: form.role,
        status: form.role === 'Super User' ? 'Active' : form.status,
        userId: form.userId
      };

      if (user.id === 'new') {
        const result = await createUserByAdmin({
          ...payload,
          temporaryPassword: form.temporaryPassword
        });
        setSuccessMessage(`User added. Temporary password: ${result.temporaryPassword}`);
      } else {
        await updateUserProfile(user.id, payload, currentUserProfile);
        if (canManageAdminUsers && form.temporaryPassword) {
          await updateUserPasswordByAdmin(user.userId || user.id, form.temporaryPassword);
        }
        setSuccessMessage('User profile saved.');
      }

      setEditingUserId('');
      setForm(null);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingUserId('');
    }
  }

  async function handleArchiveToggle(user) {
    if (!canArchiveUser(user, canManageAdminUsers, currentUserProfile) || user.id === 'new') {
      return;
    }

    const isArchived = isArchivedProfile(user);
    const confirmed = window.confirm(
      isArchived
        ? `Reactivate "${user.name || user.email || 'this profile'}"?`
        : `Archive "${user.name || user.email || 'this profile'}"?`
    );

    if (!confirmed) {
      return;
    }

    setError('');
    setSuccessMessage('');
    setSavingUserId(user.id);

    try {
      if (isArchived) {
        await reactivateUserProfile(user.id, currentUserProfile);
      } else {
        await archiveUserProfile(user.id, currentUserProfile);
      }

      if (editingUserId === user.id) {
        setEditingUserId('');
        setForm(null);
      }

      setQuickFilter(isArchived ? 'all' : 'archived');
      setSuccessMessage(isArchived ? 'User profile reactivated.' : 'User profile archived.');
    } catch (archiveError) {
      setError(archiveError.message);
    } finally {
      setSavingUserId('');
    }
  }

  if (loadingUsers) {
    return (
      <section className="admin-list-panel">
        <div className="empty-state">
          <h2>Loading Users</h2>
          <p>Retrieving user profiles from Firestore.</p>
        </div>
      </section>
    );
  }

  const sortedFilteredUsers = sortUsers(searchedUsers, sortConfig);

  return (
    <section className="admin-list-panel" id="user-controls-card">
      <div className="form-section-header form-section-header-stacked">
        <h2>User Controls</h2>
        <div className="admin-list-panel-actions">
          <button
            className="button-link button-reset secondary-action"
            disabled={Boolean(editingUserId)}
            type="button"
            onClick={startAddUser}
          >
            Add User
          </button>
        </div>
      </div>
      <p className="form-help">
        {canManageAdminUsers
          ? 'Super Users control profile roles and admin permissions.'
          : 'Admins can add and update General User profiles.'}
      </p>
      <div className="profile-search-row">
        <label>
          <span>Search Profiles</span>
          <input
            type="search"
            placeholder="Search name, email, phone, role, or membership"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </label>
        {searchTerm ? (
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={() => setSearchTerm('')}
          >
            Clear Search
          </button>
        ) : null}
      </div>
      <span className="form-help profile-match-count profile-search-count" aria-live="polite">
        {searchTerm
          ? `${searchedUsers.length} matching ${filteredUsers.length} filtered profiles`
          : `${filteredUsers.length} shown of ${users.length} total profiles`}
      </span>
      <div className="status-filter-group" aria-label="Quick profile filter">
        {QUICK_FILTERS.filter((filter) => canManageAdminUsers || filter.key !== 'admins').map((filter) => (
          <button
            className={`status-filter-button${quickFilter === filter.key ? ' active' : ''}${filter.key === 'archived' && quickFilter === filter.key ? ' archive-active' : ''}`}
            key={filter.key}
            type="button"
            onClick={() => setQuickFilter(filter.key)}
          >
            {filter.key === 'admins'
              ? `${filter.label} (${getFilteredUsers(users, filter.key, membershipFilter).length})`
              : filter.key === 'archived'
                ? `${filter.label} (${getFilteredUsers(users, filter.key, membershipFilter).length})`
                : `${filter.label} (${getFilteredUsers(users, filter.key, membershipFilter).length})`}
          </button>
        ))}
      </div>
      <div className="status-filter-group separated-filter-row" aria-label="Membership filter">
        {MEMBERSHIP_FILTERS.map((status) => (
          <button
            className={`status-filter-button${membershipFilter === status ? ' active' : ''}${status === 'Archived' && membershipFilter === status ? ' archive-active' : ''}`}
            disabled={quickFilter !== 'all'}
            key={status}
            type="button"
            onClick={() => setMembershipFilter(status)}
          >
            {status === 'All'
              ? `All Membership (${getFilteredUsers(users, 'all', status).length})`
              : `${status} (${getFilteredUsers(users, 'all', status).length})`}
          </button>
        ))}
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      <div className="event-admin-list">
        {editingUserId === 'new' ? (
          <article className="user-admin-card">
            <div>
              <div className="card-kicker">
                <span>New User</span>
                <strong>{form.status}</strong>
              </div>
              <div className="user-edit-grid">
                <label>
                  <span>First Name</span>
                  <input
                    required
                    value={form.firstName}
                    onChange={(event) => updateFormField('firstName', event.target.value)}
                    onBlur={(event) => updateFormField('firstName', toTitleCase(event.target.value))}
                  />
                </label>
                <label>
                  <span>Last Name</span>
                  <input
                    required
                    value={form.lastName}
                    onChange={(event) => updateFormField('lastName', event.target.value)}
                    onBlur={(event) => updateFormField('lastName', toTitleCase(event.target.value))}
                  />
                </label>
                <label>
                  <span>Email</span>
                  <input
                    required
                    type="email"
                    value={form.email}
                    onChange={(event) => updateFormField('email', event.target.value)}
                  />
                </label>
                <label>
                  <span>Phone</span>
                  <input
                    value={form.phone}
                    onChange={(event) =>
                      updateFormField('phone', formatPhoneNumber(event.target.value))
                    }
                  />
                </label>
                <label>
                  <span>Temporary Password</span>
                  <input
                    placeholder="Leave blank to generate"
                    minLength={8}
                    type="text"
                    value={form.temporaryPassword}
                    onChange={(event) =>
                      updateFormField('temporaryPassword', event.target.value)
                    }
                  />
                </label>
                <div className="profile-address-panel">
                  <span className="field-label">Billing Address</span>
                  <label>
                    <span>Street Address</span>
                    <input
                      value={form.billingAddress.street}
                      onBlur={(event) =>
                        updateBillingAddressField('street', toTitleCase(event.target.value))
                      }
                      onChange={(event) =>
                        updateBillingAddressField('street', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>City</span>
                    <input
                      value={form.billingAddress.city}
                      onBlur={(event) =>
                        updateBillingAddressField('city', toTitleCase(event.target.value))
                      }
                      onChange={(event) =>
                        updateBillingAddressField('city', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>State</span>
                    <select
                      value={form.billingAddress.state}
                      onChange={(event) =>
                        updateBillingAddressField('state', event.target.value)
                      }
                    >
                      <option value="">Select State</option>
                      {US_STATES.map((state) => (
                        <option key={state.value} value={state.value}>
                          {state.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>ZIP Code</span>
                    <input
                      value={form.billingAddress.postalCode}
                      onChange={(event) =>
                        updateBillingAddressField('postalCode', event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Country</span>
                    <input
                      value={form.billingAddress.country}
                      onBlur={(event) =>
                        updateBillingAddressField('country', toTitleCase(event.target.value))
                      }
                      onChange={(event) =>
                        updateBillingAddressField('country', event.target.value)
                      }
                    />
                  </label>
                </div>
                {canManageAdminUsers ? (
                  <label>
                    <span>Role</span>
                    <select
                      value={form.role}
                      onChange={(event) => updateRole(event.target.value)}
                    >
                      {USER_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <label>
                  <span>Status</span>
                  <select
                    value={form.status}
                    onChange={(event) => updateFormField('status', event.target.value)}
                  >
                    {USER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                {canManageAdminUsers ? (
                  <PermissionPanel
                    permissions={form.permissions}
                    role={form.role}
                    onChange={updatePermission}
                  />
                ) : null}
                {canManageAdminUsers ? (
                  <ProfileTagPanel profileTags={form.profileTags} onChange={updateProfileTag} />
                ) : null}
              </div>
            </div>
            <div className="card-actions">
              <button
                className="button-link button-reset"
                disabled={Boolean(savingUserId)}
                type="button"
                onClick={() => handleSave({ id: 'new' })}
              >
                {savingUserId === 'new' ? 'Adding...' : 'Add User'}
              </button>
              <button
                className="button-link button-reset secondary-action"
                disabled={Boolean(savingUserId)}
                type="button"
                onClick={() => {
                  setEditingUserId('');
                  setForm(null);
                }}
              >
                Cancel
              </button>
            </div>
          </article>
        ) : null}
        {!editingUserId ? (
          <UserTable
            canManageAdminUsers={canManageAdminUsers}
            currentUserProfile={currentUserProfile}
            detailsUserId={detailsUserId}
            sortConfig={sortConfig}
            users={sortedFilteredUsers}
            onDetails={(userId) =>
              setDetailsUserId((currentUserId) => (currentUserId === userId ? '' : userId))
            }
            onEdit={startEdit}
            onArchive={handleArchiveToggle}
            onSort={(key) => setSortConfig((current) => ({
              key,
              direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
            }))}
          />
        ) : null}
        {users.map((user) => {
          const isEditing = editingUserId === user.id;

          if (!isEditing) {
            return null;
          }

          return (
            <article className="user-admin-card" key={user.id}>
              <div>
                <div className="card-kicker">
                  <span>{user.role || 'General User'}</span>
                  <strong>{getDisplayProfileStatus(user)}</strong>
                </div>
                <div className="user-edit-grid">
                    <label>
                      <span>First Name</span>
                      <input
                        value={form.firstName}
                        onChange={(event) => updateFormField('firstName', event.target.value)}
                        onBlur={(event) => updateFormField('firstName', toTitleCase(event.target.value))}
                      />
                    </label>
                    <label>
                      <span>Last Name</span>
                      <input
                        value={form.lastName}
                        onChange={(event) => updateFormField('lastName', event.target.value)}
                        onBlur={(event) => updateFormField('lastName', toTitleCase(event.target.value))}
                      />
                    </label>
                    <label>
                      <span>Email</span>
                      <input
                        type="email"
                        value={form.email}
                        onChange={(event) => updateFormField('email', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Phone</span>
                      <input
                        value={form.phone}
                        onChange={(event) =>
                          updateFormField('phone', formatPhoneNumber(event.target.value))
                        }
                      />
                    </label>
                    <div className="profile-address-panel">
                      <span className="field-label">Billing Address</span>
                      <label>
                        <span>Street Address</span>
                        <input
                          value={form.billingAddress.street}
                          onBlur={(event) =>
                            updateBillingAddressField('street', toTitleCase(event.target.value))
                          }
                          onChange={(event) =>
                            updateBillingAddressField('street', event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>City</span>
                        <input
                          value={form.billingAddress.city}
                          onBlur={(event) =>
                            updateBillingAddressField('city', toTitleCase(event.target.value))
                          }
                          onChange={(event) =>
                            updateBillingAddressField('city', event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>State</span>
                        <select
                          value={form.billingAddress.state}
                          onChange={(event) =>
                            updateBillingAddressField('state', event.target.value)
                          }
                        >
                          <option value="">Select State</option>
                          {US_STATES.map((state) => (
                            <option key={state.value} value={state.value}>
                              {state.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        <span>ZIP Code</span>
                        <input
                          value={form.billingAddress.postalCode}
                          onChange={(event) =>
                            updateBillingAddressField('postalCode', event.target.value)
                          }
                        />
                      </label>
                      <label>
                        <span>Country</span>
                        <input
                          value={form.billingAddress.country}
                          onBlur={(event) =>
                            updateBillingAddressField('country', toTitleCase(event.target.value))
                          }
                          onChange={(event) =>
                            updateBillingAddressField('country', event.target.value)
                          }
                        />
                      </label>
                    </div>
                    {canManageAdminUsers ? (
                      <label>
                        <span>Role</span>
                        <select
                          value={form.role}
                          onChange={(event) => updateRole(event.target.value)}
                        >
                          {USER_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                    <label>
                      <span>Status</span>
                      <select
                        disabled={form.role === 'Super User'}
                        value={form.status}
                        onChange={(event) => updateFormField('status', event.target.value)}
                      >
                        {USER_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="password-panel">
                      <span className="field-label">Membership</span>
                      {canEditMembershipStatus && user.role !== 'Super User' ? (
                        <label>
                          <span>Membership Status</span>
                          <select
                            value={form.membershipStatus}
                            onChange={(event) =>
                              updateFormField('membershipStatus', event.target.value)
                            }
                          >
                            {MEMBERSHIP_STATUS_OPTIONS.map((status) => (
                              <option key={status} value={status}>
                                {status}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : (
                        <span className="form-help">
                          {getDisplayMembershipStatus(user)}
                          {user.membershipMatchedBy ? `, matched by ${user.membershipMatchedBy}` : ''}
                        </span>
                      )}
                    </div>
                    {canManageAdminUsers ? (
                      <PermissionPanel
                        permissions={form.permissions}
                        role={form.role}
                        onChange={updatePermission}
                      />
                    ) : null}
                    {canManageAdminUsers ? (
                      <ProfileTagPanel profileTags={form.profileTags} onChange={updateProfileTag} />
                    ) : null}
                    {canManageAdminUsers ? (
                      <div className="password-panel">
                        <span className="field-label">Change Password</span>
                        <label>
                          <span>New Temporary Password</span>
                          <input
                            minLength={8}
                            placeholder="Leave blank to keep current password"
                            type="text"
                            value={form.temporaryPassword}
                            onChange={(event) =>
                              updateFormField('temporaryPassword', event.target.value)
                            }
                          />
                        </label>
                        <span className="form-help">Use at least 8 characters.</span>
                      </div>
                    ) : null}
                </div>
              </div>
              <div className="card-actions">
                <button
                  className="button-link button-reset"
                  disabled={Boolean(savingUserId)}
                  type="button"
                  onClick={() => handleSave(user)}
                >
                  {savingUserId === user.id ? 'Saving...' : 'Save User'}
                </button>
                <button
                  className="button-link button-reset secondary-action"
                  disabled={Boolean(savingUserId)}
                  type="button"
                  onClick={() => {
                    setEditingUserId('');
                    setForm(null);
                  }}
                >
                  Cancel
                </button>
                {canArchiveUser(user, canManageAdminUsers, currentUserProfile) ? (
                  <button
                    className={isArchivedProfile(user)
                      ? 'button-link button-reset secondary-action archive-action'
                      : 'danger-button archive-action'}
                    disabled={Boolean(savingUserId)}
                    type="button"
                    onClick={() => handleArchiveToggle(user)}
                  >
                    {isArchivedProfile(user) ? 'Reactivate' : 'Archive'}
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function getPermissionSummary(permissions) {
  const selectedPermissions = USER_PERMISSION_OPTIONS
    .filter((permission) => permissions[permission.key])
    .map((permission) => permission.label);

  return selectedPermissions.length ? selectedPermissions.join(', ') : 'No Admin Permissions';
}

function hasSelectedAdminPermission(permissions) {
  return USER_PERMISSION_OPTIONS.some((permission) => permissions[permission.key]);
}

function getDisplayMembershipStatus(user) {
  return user.role === 'Super User' ? 'N/A' : user.membershipStatus || 'Unknown';
}

function getDisplayProfileStatus(user) {
  return user.role === 'Super User' ? 'Active' : user.status || 'Active';
}

function isVisibleAdminProfile(user) {
  return ['Admin', 'Super User'].includes(user.role)
    && !isArchivedProfile(user);
}

function isArchivedProfile(user) {
  return Boolean(user.archivedDate || user.archivedBy)
    || getDisplayProfileStatus(user) === 'Archived';
}

function sortUsers(users, sortConfig) {
  return [...users].sort((firstUser, secondUser) => {
    const firstValue = getUserSortValue(firstUser, sortConfig.key);
    const secondValue = getUserSortValue(secondUser, sortConfig.key);
    const comparison = firstValue.localeCompare(secondValue, undefined, {
      numeric: true,
      sensitivity: 'base'
    });

    return sortConfig.direction === 'asc' ? comparison : -comparison;
  });
}

function getUserSortValue(user, key) {
  if (key === 'lastName') {
    return [
      getProfileLastName(user),
      getProfileFirstName(user),
      user.email || ''
    ].join(' ');
  }

  if (key === 'role') {
    return user.role || 'General User';
  }

  if (key === 'email') {
    return user.email || '';
  }

  return user.name || user.email || '';
}

function getFilteredUsers(users, quickFilter, membershipFilter) {
  return users.filter((user) => {
    if (quickFilter === 'admins') {
      return isVisibleAdminProfile(user);
    }

    if (quickFilter === 'archived') {
      return isArchivedProfile(user);
    }

    const membershipStatus = getDisplayMembershipStatus(user);

    return !isArchivedProfile(user)
      && (membershipFilter === 'All'
        || (user.role !== 'Super User' && membershipStatus === membershipFilter));
  });
}

function searchUsers(users, searchTerm) {
  const normalizedSearch = searchTerm.trim().toLowerCase();

  if (!normalizedSearch) {
    return users;
  }

  return users.filter((user) => getUserSearchText(user).includes(normalizedSearch));
}

function getUserSearchText(user) {
  return [
    user.name,
    getProfileFirstName(user),
    getProfileLastName(user),
    user.email,
    user.phone,
    user.role,
    getDisplayMembershipStatus(user),
    getDisplayProfileStatus(user),
    user.membershipMatchedBy,
    user.membershipMemberId,
    user.userId,
    user.id
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function formatAddress(address = {}) {
  return [
    address.street,
    address.city,
    [address.state, address.postalCode].filter(Boolean).join(' '),
    address.country
  ]
    .filter(Boolean)
    .join(', ') || 'No Billing Address';
}

function formatDateTime(value) {
  if (!value) {
    return 'Not Set';
  }

  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);

  return Number.isNaN(date.getTime()) ? 'Not Set' : date.toLocaleString();
}

function UserTable({
  canManageAdminUsers,
  currentUserProfile,
  detailsUserId,
  sortConfig,
  users,
  onDetails,
  onEdit,
  onArchive,
  onSort
}) {
  if (!users.length) {
    return <p className="empty-inline">No user profiles match the selected filters.</p>;
  }

  return (
    <div className="user-table-wrap">
      <table className="user-table">
        <thead>
          <tr>
            <SortableHeader label="Name" sortKey="lastName" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="Role" sortKey="role" sortConfig={sortConfig} onSort={onSort} />
            <SortableHeader label="Email" sortKey="email" sortConfig={sortConfig} onSort={onSort} />
            <th>Membership</th>
            <th>Status</th>
            <th>Permissions</th>
            <th>Actions</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => {
            const isCurrentUser =
              user.id === currentUserProfile?.id ||
              user.userId === currentUserProfile?.userId;
            const displayPermissions = normalizePermissions(user.permissions);
            const displayMembership = getDisplayMembershipStatus(user);
            const displayStatus = getDisplayProfileStatus(user);
            const userId = user.userId || user.id;
            const detailsOpen = detailsUserId === user.id;

            return (
              <Fragment key={user.id}>
                <tr>
                  <td data-label="Name">
                    <strong>{user.name || 'Unnamed User'}</strong>
                  </td>
                  <td data-label="Role">{user.role || 'General User'}</td>
                  <td data-label="Email">{user.email || 'Email TBD'}</td>
                  <td data-label="Membership">{displayMembership}</td>
                  <td data-label="Status">{displayStatus}</td>
                  <td data-label="Permissions">
                    {user.role === 'Super User'
                      ? 'All Permissions'
                      : getPermissionSummary(displayPermissions)}
                  </td>
                  <td data-label="Actions">
                    <div className="card-actions">
                      {isCurrentUser ? (
                        <span className="form-help">Current User</span>
                      ) : canEditUser(user, canManageAdminUsers) ? (
                        <>
                          <button
                            className="button-link button-reset"
                            type="button"
                            onClick={() => onEdit(user)}
                          >
                            Edit
                          </button>
                        </>
                      ) : (
                        <span className="form-help">Admin Profile</span>
                      )}
                    </div>
                  </td>
                  <td data-label="Details">
                    <button
                      className="button-link button-reset secondary-action"
                      type="button"
                      onClick={() => onDetails(user.id)}
                    >
                      {detailsOpen ? 'Hide Details' : 'Details'}
                    </button>
                  </td>
                </tr>
                {detailsOpen ? (
                  <tr className="configuration-detail-row">
                    <td className="configuration-detail-cell" colSpan={8}>
                      <div className="user-detail-grid">
                        <span>
                          <strong>Name</strong>
                          {user.name || 'Unnamed User'}
                        </span>
                        <span>
                          <strong>First Name</strong>
                          {getProfileFirstName(user) || 'Not Set'}
                        </span>
                        <span>
                          <strong>Last Name</strong>
                          {getProfileLastName(user) || 'Not Set'}
                        </span>
                        <span>
                          <strong>Email</strong>
                          {user.email || 'Email TBD'}
                        </span>
                        <span>
                          <strong>Phone</strong>
                          {user.phone || 'Phone TBD'}
                        </span>
                        <span>
                          <strong>Role</strong>
                          {user.role || 'General User'}
                        </span>
                        <span>
                          <strong>Status</strong>
                          {displayStatus}
                        </span>
                        <span>
                          <strong>Membership Status</strong>
                          {displayMembership}
                        </span>
                        <span>
                          <strong>Permissions</strong>
                          {user.role === 'Super User'
                            ? 'All Permissions'
                            : getPermissionSummary(displayPermissions)}
                        </span>
                        {canManageAdminUsers ? (
                          <span>
                            <strong>Tags</strong>
                            {normalizeProfileTags(user.profileTags).join(', ') || 'No Tags'}
                          </span>
                        ) : null}
                        <span>
                          <strong>Billing Address</strong>
                          {formatAddress(user.billingAddress)}
                        </span>
                        <span>
                          <strong>Matched By</strong>
                          {user.membershipMatchedBy || 'Not Matched'}
                        </span>
                        <span>
                          <strong>Member ID</strong>
                          {user.membershipMemberId || 'No Member Link'}
                        </span>
                        <span>
                          <strong>User ID</strong>
                          {userId}
                        </span>
                        <span>
                          <strong>Created</strong>
                          {formatDateTime(user.createdDate)}
                        </span>
                        <span>
                          <strong>Updated</strong>
                          {formatDateTime(user.updatedDate)}
                        </span>
                        <span>
                          <strong>Membership Updated</strong>
                          {formatDateTime(user.membershipUpdatedDate)}
                        </span>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({ label, sortKey, sortConfig, onSort }) {
  const isActive = sortConfig.key === sortKey;

  return (
    <th>
      <button
        className={`table-sort-button${isActive ? ' active' : ''}`}
        type="button"
        onClick={() => onSort(sortKey)}
      >
        {label}
        <span>{isActive ? (sortConfig.direction === 'asc' ? 'A-Z' : 'Z-A') : 'Sort'}</span>
      </button>
    </th>
  );
}

function PermissionPanel({ permissions, role, onChange }) {
  return (
    <div className="permission-panel">
      <span className="field-label">Admin Permissions</span>
      {USER_PERMISSION_OPTIONS.map((permission) => (
        <label className="checkbox-label" key={permission.key}>
          <input
            checked={Boolean(permissions[permission.key])}
            disabled={role !== 'Admin'}
            type="checkbox"
            onChange={(event) => onChange(permission.key, event.target.checked)}
          />
          <span>{permission.label}</span>
        </label>
      ))}
    </div>
  );
}

function ProfileTagPanel({ profileTags, onChange }) {
  const normalizedTags = normalizeProfileTags(profileTags);

  return (
    <div className="permission-panel">
      <span className="field-label">Profile Tags</span>
      {PROFILE_TAG_OPTIONS.map((tag) => (
        <label className="checkbox-label" key={tag.key}>
          <input
            checked={normalizedTags.includes(tag.key)}
            type="checkbox"
            onChange={(event) => onChange(tag.key, event.target.checked)}
          />
          <span>{tag.label}</span>
        </label>
      ))}
    </div>
  );
}

function canEditUser(user, canManageAdminUsers) {
  return canManageAdminUsers || user.role === 'General User';
}

function canArchiveUser(user, canManageAdminUsers, currentUserProfile) {
  const isCurrentUser =
    user.id === currentUserProfile?.id || user.userId === currentUserProfile?.userId;

  return !isCurrentUser && user.role !== 'Super User' && (canManageAdminUsers || user.role === 'General User');
}

export default UserControlPanel;
