import { useEffect, useState } from 'react';
import {
  DEFAULT_USER_PERMISSIONS,
  USER_PERMISSION_OPTIONS,
  USER_ROLES,
  USER_STATUSES,
  normalizePermissions
} from '../../data/userRoles.js';
import { subscribeToUsers, updateUserProfile } from '../../services/userService.js';

function UserControlPanel({ currentUserProfile }) {
  const [editingUserId, setEditingUserId] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState(null);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [savingUserId, setSavingUserId] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    const unsubscribe = subscribeToUsers(
      (snapshot) => {
        setUsers(snapshot.docs.map((userDoc) => ({ id: userDoc.id, ...userDoc.data() })));
        setError('');
        setLoadingUsers(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoadingUsers(false);
      }
    );

    return unsubscribe;
  }, []);

  function startEdit(user) {
    setEditingUserId(user.id);
    setSuccessMessage('');
    setForm({
      email: user.email || '',
      name: user.name || '',
      permissions: normalizePermissions(user.permissions),
      phone: user.phone || '',
      role: user.role || 'General User',
      status: user.status || 'Active',
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

  async function handleSave(user) {
    setError('');
    setSuccessMessage('');
    setSavingUserId(user.id);

    try {
      await updateUserProfile(
        user.id,
        {
          email: form.email.trim(),
          name: toTitleCase(form.name),
          permissions:
            form.role === 'Admin'
              ? normalizePermissions(form.permissions)
              : DEFAULT_USER_PERMISSIONS,
          phone: form.phone.trim(),
          role: form.role,
          status: form.status,
          userId: form.userId
        },
        currentUserProfile
      );
      setEditingUserId('');
      setForm(null);
      setSuccessMessage('User profile saved.');
    } catch (saveError) {
      setError(saveError.message);
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
      <div className="form-section-header">
        <h2>User Controls</h2>
        <span>{users.length} total</span>
      </div>
      <p className="form-help">
        Super Users control profile roles and admin permissions.
      </p>
      {error ? <p className="form-error">{error}</p> : null}
      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      <div className="event-admin-list">
        {users.map((user) => {
          const isEditing = editingUserId === user.id;
          const isCurrentUser =
            user.id === currentUserProfile?.id ||
            user.userId === currentUserProfile?.userId;
          const displayPermissions = normalizePermissions(user.permissions);

          return (
            <article className="user-admin-card" key={user.id}>
              <div>
                <div className="card-kicker">
                  <span>{user.role || 'General User'}</span>
                  <strong>{user.status || 'Active'}</strong>
                </div>
                {isEditing ? (
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
                        onChange={(event) => updateFormField('phone', event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Role</span>
                      <select
                        value={form.role}
                        onChange={(event) => updateFormField('role', event.target.value)}
                      >
                        {USER_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </label>
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
                    <div className="permission-panel">
                      <span className="field-label">Admin Permissions</span>
                      {USER_PERMISSION_OPTIONS.map((permission) => (
                        <label className="checkbox-label" key={permission.key}>
                          <input
                            checked={Boolean(form.permissions[permission.key])}
                            disabled={form.role !== 'Admin'}
                            type="checkbox"
                            onChange={(event) =>
                              updatePermission(permission.key, event.target.checked)
                            }
                          />
                          <span>{permission.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <>
                    <h3>{user.name || 'Unnamed User'}</h3>
                    <p>{user.email}</p>
                    <dl>
                      <div>
                        <dt>Phone</dt>
                        <dd>{user.phone || 'Phone TBD'}</dd>
                      </div>
                      <div>
                        <dt>Billing Address</dt>
                        <dd>{formatBillingAddress(user.billingAddress)}</dd>
                      </div>
                      <div>
                        <dt>Permissions</dt>
                        <dd>
                          {user.role === 'Super User'
                            ? 'All Permissions'
                            : getPermissionSummary(displayPermissions)}
                        </dd>
                      </div>
                    </dl>
                  </>
                )}
              </div>
              <div className="card-actions">
                {isEditing ? (
                  <>
                    <button
                      className="button-link button-reset"
                      disabled={Boolean(savingUserId)}
                      type="button"
                      onClick={() => handleSave(user)}
                    >
                      {savingUserId === user.id ? 'Saving...' : 'Save User'}
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
                  </>
                ) : isCurrentUser ? (
                  <span className="form-help">Current User</span>
                ) : (
                  <button
                    className="button-link button-reset"
                    type="button"
                    onClick={() => startEdit(user)}
                  >
                    Edit User
                  </button>
                )}
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

function formatBillingAddress(billingAddress = {}) {
  const lineOne = billingAddress.street;
  const lineTwo = [
    billingAddress.city,
    billingAddress.state,
    billingAddress.postalCode
  ]
    .filter(Boolean)
    .join(', ');
  const lines = [lineOne, lineTwo, billingAddress.country].filter(Boolean);

  return lines.length ? lines.join(' | ') : 'Billing Address TBD';
}

function toTitleCase(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

export default UserControlPanel;
