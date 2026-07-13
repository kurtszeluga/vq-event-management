import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  getProfileTagSummary,
  normalizeProfileTags,
  PROFILE_TAG_OPTIONS
} from '../../data/profileTags.js';
import { US_STATES } from '../../data/usStates.js';
import {
  DEFAULT_USER_PERMISSIONS,
  USER_PERMISSION_OPTIONS,
  USER_ROLES,
  USER_STATUSES,
  normalizePermissions
} from '../../data/userRoles.js';
import {
  createUserByAdmin,
  subscribeToUsers,
  updateUserPasswordByAdmin,
  updateUserProfile
} from '../../services/userService.js';
import {
  buildBillingAddress,
  formatPhoneNumber,
  toTitleCase
} from '../../utils/profileFormat.js';

const MEMBERSHIP_FILTERS = ['All', 'Active', 'Inactive', 'Archived', 'Unknown'];
const PROFILE_STATUS_FILTERS = ['All', ...USER_STATUSES];
const QUICK_FILTERS = [
  { key: 'all', label: 'All Profiles' },
  { key: 'admins', label: 'Admins' }
];

function UserControlPanel({ canManageAdminUsers = false, currentUserProfile }) {
  const [detailsUserId, setDetailsUserId] = useState('');
  const [editingUserId, setEditingUserId] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [membershipFilter, setMembershipFilter] = useState('All');
  const [profileStatusFilter, setProfileStatusFilter] = useState('All');
  const [quickFilter, setQuickFilter] = useState('all');
  const [savingUserId, setSavingUserId] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [users, setUsers] = useState([]);

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

  const membershipCountableUsers = users.filter((user) => user.role !== 'Super User');
  const membershipCounts = getCounts(membershipCountableUsers, getDisplayMembershipStatus);
  const profileStatusCounts = getCounts(users, getDisplayProfileStatus);
  const adminUsers = users.filter(isVisibleAdminProfile);
  const filteredUsers = users.filter((user) => {
    if (quickFilter === 'admins') {
      return isVisibleAdminProfile(user);
    }

    const membershipStatus = getDisplayMembershipStatus(user);
    const profileStatus = getDisplayProfileStatus(user);

    return (membershipFilter === 'All' || user.role !== 'Super User' && membershipStatus === membershipFilter)
      && (profileStatusFilter === 'All' || profileStatus === profileStatusFilter);
  });

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
      name: '',
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
      name: user.name || '',
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
      if (!form.name.trim() || !form.email.trim()) {
        throw new Error('Name and email are required.');
      }

      if (form.temporaryPassword && form.temporaryPassword.length < 8) {
        throw new Error('Temporary password must be at least 8 characters.');
      }

      if (!canManageAdminUsers && form.role !== 'General User') {
        throw new Error('Admins can only update General User profiles.');
      }

      const payload = {
        billingAddress: buildBillingAddress(form.billingAddress),
        email: form.email.trim(),
        name: toTitleCase(form.name),
        permissions:
          canManageAdminUsers && form.role === 'Admin'
            ? normalizePermissions(form.permissions)
            : DEFAULT_USER_PERMISSIONS,
        phone: formatPhoneNumber(form.phone),
        profileTags: normalizeProfileTags(form.profileTags),
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

  async function handleArchive(user) {
    if (!canArchiveUser(user, canManageAdminUsers, currentUserProfile) || user.id === 'new') {
      return;
    }

    const confirmed = window.confirm(`Archive "${user.name || user.email || 'this profile'}"?`);

    if (!confirmed) {
      return;
    }

    setError('');
    setSuccessMessage('');
    setSavingUserId(user.id);

    try {
      await updateUserProfile(
        user.id,
        {
          ...user,
          status: 'Archived'
        },
        currentUserProfile
      );

      if (editingUserId === user.id) {
        setEditingUserId('');
        setForm(null);
      }

      setSuccessMessage('User profile archived.');
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
      <span className="form-help">
        {filteredUsers.length} shown of {users.length} total profiles
      </span>
      <p className="form-help">
        {canManageAdminUsers
          ? 'Super Users control profile roles and admin permissions.'
          : 'Admins can add and update General User profiles.'}
      </p>
      {canManageAdminUsers ? (
        <div className="status-filter-group" aria-label="Quick profile filter">
          {QUICK_FILTERS.map((filter) => (
            <button
              className={`status-filter-button${quickFilter === filter.key ? ' active' : ''}`}
              key={filter.key}
              type="button"
              onClick={() => setQuickFilter(filter.key)}
            >
              {filter.key === 'admins' ? `${filter.label} (${adminUsers.length})` : `${filter.label} (${users.length})`}
            </button>
          ))}
        </div>
      ) : null}
      <div className="status-filter-group separated-filter-row" aria-label="Membership filter">
        {MEMBERSHIP_FILTERS.map((status) => (
          <button
            className={`status-filter-button${membershipFilter === status ? ' active' : ''}`}
            disabled={quickFilter === 'admins'}
            key={status}
            type="button"
            onClick={() => setMembershipFilter(status)}
          >
            {status === 'All'
              ? `All Membership (${membershipCountableUsers.length})`
              : `${status} (${membershipCounts[status] || 0})`}
          </button>
        ))}
      </div>
      <div className="status-filter-group separated-filter-row" aria-label="Profile status filter">
        {PROFILE_STATUS_FILTERS.map((status) => (
          <button
            className={`status-filter-button${profileStatusFilter === status ? ' active' : ''}`}
            disabled={quickFilter === 'admins'}
            key={status}
            type="button"
            onClick={() => setProfileStatusFilter(status)}
          >
            {status === 'All' ? `All Status (${users.length})` : `${status} (${profileStatusCounts[status] || 0})`}
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
                  <span>Name</span>
                  <input
                    required
                    value={form.name}
                    onChange={(event) => updateFormField('name', event.target.value)}
                    onBlur={(event) => updateFormField('name', toTitleCase(event.target.value))}
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
                      onChange={(event) => {
                        updateFormField('role', event.target.value);
                        if (event.target.value === 'Super User') {
                          updateFormField('status', 'Active');
                        }
                      }}
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
                <ProfileTagPanel profileTags={form.profileTags} onChange={updateProfileTag} />
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
                className="text-button"
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
            users={filteredUsers}
            onDetails={(userId) =>
              setDetailsUserId((currentUserId) => (currentUserId === userId ? '' : userId))
            }
            onEdit={startEdit}
            onArchive={handleArchive}
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
                      <span>Name</span>
                      <input
                        value={form.name}
                        onChange={(event) => updateFormField('name', event.target.value)}
                        onBlur={(event) => updateFormField('name', toTitleCase(event.target.value))}
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
                          onChange={(event) => {
                            updateFormField('role', event.target.value);
                            if (event.target.value === 'Super User') {
                              updateFormField('status', 'Active');
                            }
                          }}
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
                      <span className="form-help">
                        {getDisplayMembershipStatus(user)}
                        {user.membershipMatchedBy ? `, matched by ${user.membershipMatchedBy}` : ''}
                      </span>
                    </div>
                    {canManageAdminUsers ? (
                      <PermissionPanel
                        permissions={form.permissions}
                        role={form.role}
                        onChange={updatePermission}
                      />
                    ) : null}
                    <ProfileTagPanel profileTags={form.profileTags} onChange={updateProfileTag} />
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
                {canArchiveUser(user, canManageAdminUsers, currentUserProfile) ? (
                  <button
                    className="danger-button"
                    disabled={Boolean(savingUserId)}
                    type="button"
                    onClick={() => handleArchive(user)}
                  >
                    Archive
                  </button>
                ) : null}
                <button
                  className="text-button"
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

function getCounts(items, getValue) {
  return items.reduce((counts, item) => {
    const value = getValue(item);

    return {
      ...counts,
      [value]: (counts[value] || 0) + 1
    };
  }, {});
}

function getDisplayMembershipStatus(user) {
  return user.role === 'Super User' ? 'N/A' : user.membershipStatus || 'Unknown';
}

function getDisplayProfileStatus(user) {
  return user.role === 'Super User' ? 'Active' : user.status || 'Active';
}

function isVisibleAdminProfile(user) {
  return ['Admin', 'Super User'].includes(user.role)
    && getDisplayMembershipStatus(user) !== 'Archived';
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
  users,
  onDetails,
  onEdit,
  onArchive
}) {
  if (!users.length) {
    return <p className="empty-inline">No user profiles match the selected filters.</p>;
  }

  return (
    <div className="user-table-wrap">
      <table className="user-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
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
                    <span>{user.role || 'General User'}</span>
                  </td>
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
                    <td className="configuration-detail-cell" colSpan={7}>
                      <div className="user-detail-grid">
                        <span>
                          <strong>Name</strong>
                          {user.name || 'Unnamed User'}
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
                        <span>
                          <strong>Tags</strong>
                          {getProfileTagSummary(normalizeProfileTags(user.profileTags))}
                        </span>
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
