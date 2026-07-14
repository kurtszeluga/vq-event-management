import { Fragment, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_MEMBERSHIP_SETTINGS,
  archiveMembershipProfile,
  deleteEventLocationDefault,
  deleteEventTimeDefault,
  importMembersFromCsvRows,
  reactivateMembershipProfile,
  saveEventLocationDefault,
  saveEventTimeDefault,
  saveMembershipProfile,
  saveMembershipSettings,
  subscribeToEventLocationDefaults,
  subscribeToEventTimeDefaults,
  subscribeToMembershipProfiles,
  subscribeToMembershipSettings
} from '../../services/configurationService.js';
import { formatClockTime } from '../../utils/eventFormat.js';
import { formatPhoneNumber, toTitleCase } from '../../utils/profileFormat.js';

const EMPTY_MEMBER_FORM = {
  email: '',
  firstName: '',
  id: '',
  lastName: '',
  name: '',
  phone: '',
  status: 'Active'
};

const EMPTY_LOCATION_FORM = {
  address: '',
  id: '',
  isActive: true,
  label: '',
  sortOrder: 0,
  value: ''
};

const EMPTY_TIME_FORM = {
  endTime: '',
  id: '',
  isActive: true,
  label: '',
  sortOrder: 0,
  startTime: '',
  value: ''
};

const MEMBER_FILTERS = ['Active', 'Inactive', 'Archived', 'Unknown'];

function ConfigurationPanel({ currentUserProfile }) {
  const csvInputRef = useRef(null);
  const [error, setError] = useState('');
  const [eventLocations, setEventLocations] = useState([]);
  const [eventTimes, setEventTimes] = useState([]);
  const [importMessage, setImportMessage] = useState('');
  const [importReviewRows, setImportReviewRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [locationFormOpen, setLocationFormOpen] = useState(false);
  const [locationForm, setLocationForm] = useState(EMPTY_LOCATION_FORM);
  const [memberFormOpen, setMemberFormOpen] = useState(false);
  const [memberForm, setMemberForm] = useState(EMPTY_MEMBER_FORM);
  const [memberImportMode, setMemberImportMode] = useState('');
  const [memberStatusFilter, setMemberStatusFilter] = useState('Active');
  const [members, setMembers] = useState([]);
  const [configurationView, setConfigurationView] = useState('membership');
  const [savingSection, setSavingSection] = useState('');
  const [settings, setSettings] = useState(DEFAULT_MEMBERSHIP_SETTINGS);
  const [successMessage, setSuccessMessage] = useState('');
  const [timeFormOpen, setTimeFormOpen] = useState(false);
  const [timeForm, setTimeForm] = useState(EMPTY_TIME_FORM);
  const memberCounts = getMemberCounts(members);
  const filteredMembers = members.filter((member) =>
    (member.membershipStatus || 'Unknown') === memberStatusFilter
  );

  function renderMemberForm() {
    return (
      <form className="configuration-form-grid" onSubmit={handleSaveMember}>
        <label>
          <span>First Name</span>
          <input
            value={memberForm.firstName}
            onBlur={(event) =>
              setMemberForm((current) => ({ ...current, firstName: toTitleCase(event.target.value) }))
            }
            onChange={(event) =>
              setMemberForm((current) => ({ ...current, firstName: event.target.value }))
            }
          />
        </label>
        <label>
          <span>Last Name</span>
          <input
            value={memberForm.lastName}
            onBlur={(event) =>
              setMemberForm((current) => ({ ...current, lastName: toTitleCase(event.target.value) }))
            }
            onChange={(event) =>
              setMemberForm((current) => ({ ...current, lastName: event.target.value }))
            }
          />
        </label>
        <label>
          <span>Email</span>
          <input
            type="email"
            value={memberForm.email}
            onChange={(event) =>
              setMemberForm((current) => ({ ...current, email: event.target.value }))
            }
          />
        </label>
        <label>
          <span>Phone</span>
          <input
            type="tel"
            value={memberForm.phone}
            onChange={(event) =>
              setMemberForm((current) => ({
                ...current,
                phone: formatPhoneNumber(event.target.value)
              }))
            }
          />
        </label>
        <label>
          <span>Status</span>
          <select
            value={memberForm.status}
            onChange={(event) =>
              setMemberForm((current) => ({ ...current, status: event.target.value }))
            }
          >
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
            <option value="Archived">Archived</option>
            <option value="Unknown">Unknown</option>
          </select>
        </label>
        <div className="configuration-actions configuration-span">
          <button className="button-link button-reset" disabled={savingSection === 'member'} type="submit">
            {savingSection === 'member' ? 'Saving...' : memberForm.id ? 'Save Membership Profile' : 'Save New Profile'}
          </button>
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={() => {
              setMemberForm(EMPTY_MEMBER_FORM);
              setMemberFormOpen(false);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    );
  }

  useEffect(() => {
    let pendingLoads = 4;
    const markLoaded = () => {
      pendingLoads -= 1;
      if (pendingLoads <= 0) {
        setLoading(false);
      }
    };
    const handleError = (snapshotError) => {
      setError(snapshotError.message);
      setLoading(false);
    };
    const unsubscribers = [
      subscribeToMembershipSettings((nextSettings) => {
        setSettings(nextSettings);
        markLoaded();
      }, handleError),
      subscribeToMembershipProfiles((snapshot) => {
        setMembers(snapshot.docs.map((memberDoc) => ({ id: memberDoc.id, ...memberDoc.data() })));
        markLoaded();
      }, handleError),
      subscribeToEventLocationDefaults((snapshot) => {
        setEventLocations(
          snapshot.docs.map((locationDoc) => ({ id: locationDoc.id, ...locationDoc.data() }))
        );
        markLoaded();
      }, handleError),
      subscribeToEventTimeDefaults((snapshot) => {
        setEventTimes(snapshot.docs.map((timeDoc) => ({ id: timeDoc.id, ...timeDoc.data() })));
        markLoaded();
      }, handleError)
    ];

    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, []);

  async function handleSaveSettings(event) {
    event.preventDefault();
    await runSave('settings', async () => {
      await saveMembershipSettings(settings, currentUserProfile);
      setSuccessMessage('Membership check settings saved.');
    });
  }

  async function handleSaveMember(event) {
    event.preventDefault();

    if (
      !memberForm.firstName.trim()
      && !memberForm.lastName.trim()
      && !memberForm.name.trim()
      && !memberForm.email.trim()
      && !memberForm.phone.trim()
    ) {
      setError('Enter at least a name, email, or phone number for the profile.');
      return;
    }

    await runSave('member', async () => {
      const firstName = toTitleCase(memberForm.firstName);
      const lastName = toTitleCase(memberForm.lastName);
      await saveMembershipProfile(
        {
          ...memberForm,
          firstName,
          lastName,
          name: toTitleCase(memberForm.name || [firstName, lastName].filter(Boolean).join(' '))
        },
        currentUserProfile
      );
      setMemberForm(EMPTY_MEMBER_FORM);
      setMemberFormOpen(false);
      setSuccessMessage('Membership profile saved.');
    });
  }

  async function handleCsvUpload(event) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    if (!memberImportMode) {
      setError('Choose an import mode before uploading the membership CSV.');
      event.target.value = '';
      return;
    }

    setImportMessage('');
    setImportReviewRows([]);
    await runSave('csv', async () => {
      const text = await file.text();
      const rows = parseMemberCsv(text);

      if (!rows.length) {
        throw new Error('No membership rows were found in the CSV file.');
      }

      const importResult = await importMembersFromCsvRows(rows, currentUserProfile, {
        mode: memberImportMode
      });
      setImportReviewRows(importResult.reviewRows || []);
      const skippedText = importResult.skippedSuperUserCount
        ? ` ${importResult.skippedSuperUserCount} Super User row(s) skipped.`
        : '';
      setImportMessage(
        memberImportMode === 'annualRefresh'
          ? `${importResult.importedCount} profiles imported. ${importResult.updatedCount} updated, ${importResult.createdCount} created, ${importResult.inactivatedCount} missing profiles marked inactive membership. ${importResult.reviewCount} phone-only matches need review.${skippedText}`
          : `${importResult.importedCount} profiles imported. ${importResult.updatedCount} updated, ${importResult.createdCount} created. ${importResult.reviewCount} phone-only matches need review.${skippedText}`
      );
    });
    event.target.value = '';
  }

  async function handleSaveLocation(event) {
    event.preventDefault();

    if (!locationForm.label.trim()) {
      setError('Location label is required.');
      return;
    }

    await runSave('location', async () => {
      await saveEventLocationDefault(locationForm, currentUserProfile);
      setLocationForm(EMPTY_LOCATION_FORM);
      setLocationFormOpen(false);
      setSuccessMessage('Default location saved.');
    });
  }

  async function handleSaveTime(event) {
    event.preventDefault();

    if (!timeForm.label.trim()) {
      setError('Time label is required.');
      return;
    }

    await runSave('time', async () => {
      await saveEventTimeDefault(timeForm, currentUserProfile);
      setTimeForm(EMPTY_TIME_FORM);
      setTimeFormOpen(false);
      setSuccessMessage('Default time saved.');
    });
  }

  async function runSave(section, callback) {
    setError('');
    setSuccessMessage('');
    setSavingSection(section);

    try {
      await callback();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSavingSection('');
    }
  }

  function renderMembershipCard() {
    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Membership Check</h3>
          <p>Control whether new user accounts should be checked against profile membership status.</p>
        </div>
        <form className="configuration-card-body" onSubmit={handleSaveSettings}>
          <label className="checkbox-label">
            <input
              checked={settings.requireMembershipCheck}
              type="checkbox"
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  requireMembershipCheck: event.target.checked
                }))
              }
            />
            <span>Require Membership Check For New Users</span>
          </label>
          <label className="checkbox-label">
            <input
              checked={settings.matchByEmail}
              type="checkbox"
              onChange={(event) =>
                setSettings((current) => ({ ...current, matchByEmail: event.target.checked }))
              }
            />
            <span>Match Members By Email</span>
          </label>
          <label className="checkbox-label">
            <input
              checked={settings.matchByPhone}
              type="checkbox"
              onChange={(event) =>
                setSettings((current) => ({ ...current, matchByPhone: event.target.checked }))
              }
            />
            <span>Match Members By Phone</span>
          </label>
          <label className="checkbox-label">
            <input
              checked={settings.allowAdminSkipMembershipCheck}
              type="checkbox"
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  allowAdminSkipMembershipCheck: event.target.checked
                }))
              }
            />
            <span>Allow Admins To Skip Membership Check</span>
          </label>
          <button
            className="button-link button-reset configuration-submit-button"
            disabled={savingSection === 'settings'}
            type="submit"
          >
            {savingSection === 'settings' ? 'Saving...' : 'Save Membership Settings'}
          </button>
        </form>
      </article>
    );
  }

  function renderMemberListCard() {
    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Membership Profiles</h3>
          <p>Upload a CSV to update profile membership. Email matches update automatically; phone-only matches are held for review.</p>
          <p>CSV columns should use First Name, Last Name, Email, and Phone. Status is optional.</p>
        </div>
        <div className="configuration-summary" aria-label="Membership profile totals">
          <span>Active: {memberCounts.active}</span>
          <span>Inactive: {memberCounts.inactive}</span>
          <span>Archived: {memberCounts.archived}</span>
          <span>Unknown: {memberCounts.unknown}</span>
          <span>Total: {memberCounts.total}</span>
        </div>
        <div className="configuration-actions">
          <label className="configuration-inline-label">
            <span>Import Mode</span>
            <select
              value={memberImportMode}
              onChange={(event) => setMemberImportMode(event.target.value)}
            >
              <option value="">Choose Import Mode</option>
              <option value="addUpdate">Add/Update Only</option>
              <option value="annualRefresh">Annual Refresh</option>
            </select>
          </label>
          <input
            accept=".csv,text/csv"
            className="visually-hidden-file"
            ref={csvInputRef}
            type="file"
            onChange={handleCsvUpload}
          />
          <button
            className="button-link button-reset secondary-action"
            disabled={savingSection === 'csv' || !memberImportMode}
            type="button"
            onClick={() => csvInputRef.current?.click()}
          >
            {savingSection === 'csv' ? 'Importing...' : 'Upload Membership CSV'}
          </button>
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={() => {
              setMemberForm(EMPTY_MEMBER_FORM);
              setMemberFormOpen(true);
            }}
          >
            Add Profile
          </button>
          {importMessage ? <span className="form-help">{importMessage}</span> : null}
        </div>
        {importReviewRows.length ? (
          <div className="configuration-review-list">
            <h4>Import Review</h4>
            <p className="form-help">
              These CSV rows matched by phone only and were not updated automatically.
            </p>
            {importReviewRows.map((row, index) => (
              <div className="configuration-review-item" key={`${row.csvEmail}-${row.csvPhone}-${index}`}>
                <strong>{row.csvName || row.csvEmail || row.csvPhone || 'CSV Row'}</strong>
                <span>{row.csvEmail || 'No Email'} | {row.csvPhone || 'No Phone'}</span>
                <span>
                  Possible profile: {row.possibleMatches
                    .map((match) => match.name || match.email || match.phone)
                    .join(', ')}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="status-filter-group" aria-label="Membership status filter">
          {MEMBER_FILTERS.map((status) => (
            <button
              className={`status-filter-button${memberStatusFilter === status ? ' active' : ''}${status === 'Archived' && memberStatusFilter === status ? ' archive-active' : ''}`}
              key={status}
              type="button"
              onClick={() => setMemberStatusFilter(status)}
            >
              {status} ({memberCounts[status.toLowerCase()]})
            </button>
          ))}
        </div>
        {memberFormOpen && !memberForm.id ? renderMemberForm() : null}
        <ConfigurationTable
          columns={['First Name', 'Last Name', 'Email', 'Phone', 'Membership', 'Profile', 'Actions']}
          emptyText={`No ${memberStatusFilter.toLowerCase()} membership profiles found.`}
          rows={filteredMembers.map((member) => ({
            id: member.id,
            cells: [
              member.firstName || getFirstNameFallback(member.name) || '-',
              member.lastName || getLastNameFallback(member.name) || '-',
              member.email || '-',
              member.phone || '-',
              member.membershipStatus || 'Unknown',
              member.status || 'Active',
            <RowActions
                key={member.id}
                deleteConfirm={`${
                  member.membershipStatus === 'Archived' ? 'Reactivate' : 'Archive'
                } ${member.name || member.email || member.phone}?`}
                deleteLabel={member.membershipStatus === 'Archived' ? 'Reactivate' : 'Archive'}
                onDelete={() =>
                  (member.membershipStatus === 'Archived'
                    ? reactivateMembershipProfile(member, currentUserProfile)
                    : archiveMembershipProfile(member, currentUserProfile))
                }
                onEdit={() => {
                  setMemberForm({
                    ...EMPTY_MEMBER_FORM,
                    ...member,
                    status: member.membershipStatus || 'Unknown'
                  });
                  setMemberFormOpen(true);
                }}
              />
            ],
            detail: memberFormOpen && memberForm.id === member.id ? renderMemberForm() : null
          }))}
        />
      </article>
    );
  }

  function renderLocationCard() {
    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Default Locations</h3>
          <p>These locations appear in the event/activity location dropdown.</p>
        </div>
        <div className="configuration-actions">
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={() => {
              setLocationForm(EMPTY_LOCATION_FORM);
              setLocationFormOpen(true);
            }}
          >
            Add Location
          </button>
        </div>
        {locationFormOpen ? (
          <form className="configuration-form-grid" onSubmit={handleSaveLocation}>
            <label>
              <span>Location Label *</span>
              <input
                value={locationForm.label}
                onBlur={(event) =>
                  setLocationForm((current) => ({ ...current, label: toTitleCase(event.target.value) }))
                }
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, label: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Dropdown Value</span>
              <input
                value={locationForm.value}
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, value: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Sort Order</span>
              <input
                min="0"
                type="number"
                value={locationForm.sortOrder}
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, sortOrder: event.target.value }))
                }
              />
            </label>
            <label className="configuration-span">
              <span>Address / Notes</span>
              <input
                value={locationForm.address}
                onBlur={(event) =>
                  setLocationForm((current) => ({ ...current, address: toTitleCase(event.target.value) }))
                }
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, address: event.target.value }))
                }
              />
            </label>
            <label className="checkbox-label">
              <input
                checked={locationForm.isActive}
                type="checkbox"
                onChange={(event) =>
                  setLocationForm((current) => ({ ...current, isActive: event.target.checked }))
                }
              />
              <span>Active</span>
            </label>
            <div className="configuration-actions configuration-span">
              <button className="button-link button-reset" disabled={savingSection === 'location'} type="submit">
                {savingSection === 'location' ? 'Saving...' : locationForm.id ? 'Save Location' : 'Save New Location'}
              </button>
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => {
                  setLocationForm(EMPTY_LOCATION_FORM);
                  setLocationFormOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        <ConfigurationTable
          columns={['Location', 'Value', 'Status', 'Actions']}
          emptyText="No default locations have been added yet."
          rows={eventLocations.map((location) => ({
            id: location.id,
            cells: [
              <>
                <strong>{location.label}</strong>
                <span>{location.address}</span>
              </>,
              location.value,
              location.isActive === false ? 'Inactive' : 'Active',
              <RowActions
                key={location.id}
                onDelete={() => deleteEventLocationDefault(location, currentUserProfile)}
                onEdit={() => {
                  setLocationForm({ ...EMPTY_LOCATION_FORM, ...location });
                  setLocationFormOpen(true);
                }}
              />
            ]
          }))}
        />
      </article>
    );
  }

  function renderTimeCard() {
    return (
      <article className="configuration-mini-card">
        <div className="configuration-card-header">
          <h3>Default Start/End Times</h3>
          <p>These time blocks appear in the event/activity time dropdown.</p>
        </div>
        <div className="configuration-actions">
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={() => {
              setTimeForm(EMPTY_TIME_FORM);
              setTimeFormOpen(true);
            }}
          >
            Add Time
          </button>
        </div>
        {timeFormOpen ? (
          <form className="configuration-form-grid" onSubmit={handleSaveTime}>
            <label>
              <span>Time Label *</span>
              <input
                value={timeForm.label}
                onBlur={(event) =>
                  setTimeForm((current) => ({ ...current, label: toTitleCase(event.target.value) }))
                }
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, label: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Dropdown Value</span>
              <input
                value={timeForm.value}
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, value: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Start Time</span>
              <input
                type="time"
                value={timeForm.startTime}
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, startTime: event.target.value }))
                }
              />
            </label>
            <label>
              <span>End Time</span>
              <input
                type="time"
                value={timeForm.endTime}
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, endTime: event.target.value }))
                }
              />
            </label>
            <label>
              <span>Sort Order</span>
              <input
                min="0"
                type="number"
                value={timeForm.sortOrder}
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, sortOrder: event.target.value }))
                }
              />
            </label>
            <label className="checkbox-label">
              <input
                checked={timeForm.isActive}
                type="checkbox"
                onChange={(event) =>
                  setTimeForm((current) => ({ ...current, isActive: event.target.checked }))
                }
              />
              <span>Active</span>
            </label>
            <div className="configuration-actions configuration-span">
              <button className="button-link button-reset" disabled={savingSection === 'time'} type="submit">
                {savingSection === 'time' ? 'Saving...' : timeForm.id ? 'Save Time' : 'Save New Time'}
              </button>
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => {
                  setTimeForm(EMPTY_TIME_FORM);
                  setTimeFormOpen(false);
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
        <ConfigurationTable
          columns={['Time', 'Start/End', 'Status', 'Actions']}
          emptyText="No default times have been added yet."
          rows={eventTimes.map((timeOption) => ({
            id: timeOption.id,
            cells: [
              <>
                <strong>{timeOption.label}</strong>
                <span>{timeOption.value}</span>
              </>,
              formatConfigurationTimeRange(timeOption.startTime, timeOption.endTime),
              timeOption.isActive === false ? 'Inactive' : 'Active',
              <RowActions
                key={timeOption.id}
                onDelete={() => deleteEventTimeDefault(timeOption, currentUserProfile)}
                onEdit={() => {
                  setTimeForm({ ...EMPTY_TIME_FORM, ...timeOption });
                  setTimeFormOpen(true);
                }}
              />
            ]
          }))}
        />
      </article>
    );
  }

  return (
    <section className="admin-form configuration-panel">
      {loading ? <p>Loading configuration...</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {successMessage ? <p className="form-success">{successMessage}</p> : null}

      <section className="admin-list-panel configuration-shell">
        <div className="form-section-header form-section-header-stacked configuration-shell-header">
          <div className="form-section-header-top">
            <h2>Configuration</h2>
            <span>Super User Only</span>
          </div>
          <div className="configuration-card-actions configuration-shell-actions">
            {[
              ['membership', 'Membership Check'],
              ['members', 'Membership Profiles'],
              ['locations', 'Default Locations'],
              ['times', 'Default Start/End Times']
            ].map(([value, label]) => (
              <button
                key={value}
                className={`button-link button-reset ${configurationView === value ? '' : 'secondary-action'}`}
                type="button"
                onClick={() => setConfigurationView(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {configurationView === 'membership' ? renderMembershipCard() : null}
        {configurationView === 'members' ? renderMemberListCard() : null}
        {configurationView === 'locations' ? renderLocationCard() : null}
        {configurationView === 'times' ? renderTimeCard() : null}
      </section>
    </section>
  );
}

function RowActions({
  deleteConfirm = 'Delete this item?',
  deleteLabel = 'Delete',
  onDelete,
  onEdit
}) {
  async function handleDelete() {
    const confirmed = window.confirm(deleteConfirm);

    if (confirmed) {
      await onDelete();
    }
  }

  return (
    <div className="card-actions">
      <button className="button-link button-reset" type="button" onClick={onEdit}>
        Edit
      </button>
      <button className="danger-button archive-action" type="button" onClick={handleDelete}>
        {deleteLabel}
      </button>
    </div>
  );
}

function ConfigurationTable({ columns, emptyText, rows }) {
  if (!rows.length) {
    return <p className="empty-inline">{emptyText}</p>;
  }

  return (
    <div className="user-table-wrap">
      <table className="user-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <Fragment key={row.id}>
              <tr key={row.id}>
                {row.cells.map((cell, index) => (
                  <td data-label={columns[index]} key={`${row.id}-${columns[index]}`}>
                    {cell}
                  </td>
                ))}
              </tr>
              {row.detail ? (
                <tr className="configuration-detail-row" key={`${row.id}-detail`}>
                  <td className="configuration-detail-cell" colSpan={columns.length}>
                    {row.detail}
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function getMemberCounts(members) {
  return members.reduce(
    (counts, member) => {
      if (member.membershipStatus === 'Archived') {
        counts.archived += 1;
      } else if (member.membershipStatus === 'Inactive') {
        counts.inactive += 1;
      } else if (member.membershipStatus === 'Active') {
        counts.active += 1;
      } else {
        counts.unknown += 1;
      }

      counts.total += 1;
      return counts;
    },
    { active: 0, archived: 0, inactive: 0, total: 0, unknown: 0 }
  );
}

function getFirstNameFallback(name = '') {
  return name.trim().split(/\s+/)[0] || '';
}

function getLastNameFallback(name = '') {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  return parts.length > 1 ? parts.slice(1).join(' ') : '';
}

function formatConfigurationTimeRange(startTime, endTime) {
  const formattedStart = formatClockTime(startTime);
  const formattedEnd = formatClockTime(endTime);

  if (!formattedStart && !formattedEnd) {
    return '-';
  }

  return [formattedStart || '-', formattedEnd || '-'].join(' / ');
}

function parseMemberCsv(text) {
  const rows = parseCsvRows(text);
  const [headerRow = [], ...dataRows] = rows;
  const headers = headerRow.map(normalizeCsvHeader);
  const columnMap = getMemberCsvColumnMap(headers);

  return dataRows
    .map((row) => {
      const record = {};

      headers.forEach((header, index) => {
        record[header] = row[index] || '';
      });
      const firstName = getCsvValue(record, FIRST_NAME_HEADERS)
        || getCsvColumnValue(row, columnMap.firstName);
      const lastName = getCsvValue(record, LAST_NAME_HEADERS)
        || getCsvColumnValue(row, columnMap.lastName);
      const fullName = getCsvValue(record, [
        'name',
        'member',
        'memberName',
        'fullName',
        'displayName'
      ]);
      const email = getCsvValue(record, EMAIL_HEADERS)
        || getCsvColumnValue(row, columnMap.email);
      const phone = getCsvValue(record, PHONE_HEADERS)
        || getCsvColumnValue(row, columnMap.phone);

      return {
        email,
        firstName: toTitleCase(firstName),
        lastName: toTitleCase(lastName),
        name: toTitleCase(fullName || [firstName, lastName].filter(Boolean).join(' ')),
        notes: getCsvValue(record, ['notes', 'note', 'comments']),
        phone: formatPhoneNumber(phone),
        status: getCsvValue(record, ['status']).toLowerCase() === 'inactive'
          ? 'Inactive'
          : 'Active'
      };
    })
    .filter((row) => row.name || row.email || row.phone);
}

const FIRST_NAME_HEADERS = ['firstName', 'firstname', 'first', 'givenName', 'givenname'];
const LAST_NAME_HEADERS = ['lastName', 'lastname', 'last', 'surname', 'familyName', 'familyname'];
const EMAIL_HEADERS = ['email', 'emailAddress', 'eMail'];
const PHONE_HEADERS = ['phone', 'phoneNumber', 'telephone', 'mobile'];

function normalizeCsvHeader(header) {
  return normalizeCsvCell(header)
    .replace(/^\uFEFF/, '')
    .replace(/^ï»¿/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+([a-z0-9])/g, (_, character) => character.toUpperCase())
    .replace(/[^a-zA-Z0-9]/g, '');
}

function getCsvValue(record, keys) {
  for (const key of keys) {
    if (record[key]) {
      return normalizeCsvCell(record[key]);
    }
  }

  return '';
}

function getMemberCsvColumnMap(headers) {
  return {
    email: getHeaderIndex(headers, EMAIL_HEADERS),
    firstName: getHeaderIndex(headers, FIRST_NAME_HEADERS),
    lastName: getHeaderIndex(headers, LAST_NAME_HEADERS),
    phone: getHeaderIndex(headers, PHONE_HEADERS)
  };
}

function getHeaderIndex(headers, aliases) {
  return headers.findIndex((header) => aliases.includes(header));
}

function getCsvColumnValue(row, index) {
  return index >= 0 ? normalizeCsvCell(row[index] || '') : '';
}

function normalizeCsvCell(value) {
  return String(value || '')
    .replace(/\u00A0/g, ' ')
    .replace(/^\uFEFF/, '')
    .replace(/^ï»¿/, '')
    .trim();
}

function parseCsvRows(text) {
  const delimiter = detectCsvDelimiter(text);
  const rows = [];
  let cell = '';
  let row = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];

    if (character === '"' && inQuotes && nextCharacter === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === delimiter && !inQuotes) {
      row.push(normalizeCsvCell(cell));
      cell = '';
    } else if ((character === '\n' || character === '\r') && !inQuotes) {
      if (character === '\r' && nextCharacter === '\n') {
        index += 1;
      }
      row.push(normalizeCsvCell(cell));
      if (row.some(Boolean)) {
        rows.push(row);
      }
      cell = '';
      row = [];
    } else {
      cell += character;
    }
  }

  row.push(normalizeCsvCell(cell));
  if (row.some(Boolean)) {
    rows.push(row);
  }

  return rows;
}

function detectCsvDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const candidates = [',', '\t', ';'];

  return candidates
    .map((delimiter) => ({
      delimiter,
      count: firstLine.split(delimiter).length
    }))
    .sort((first, second) => second.count - first.count)[0].delimiter;
}

export default ConfigurationPanel;
