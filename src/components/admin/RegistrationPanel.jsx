import { useEffect, useMemo, useState } from 'react';
import {
  subscribeToAdminEvents,
  subscribeToPublishedEvents
} from '../../services/eventService.js';
import {
  subscribeToRegistrations,
  updateRegistrationStatus
} from '../../services/registrationService.js';
import { subscribeToUsers } from '../../services/userService.js';
import { formatEventDate } from '../../utils/eventFormat.js';

const REGISTRATION_STATUS_FILTERS = ['All', 'Registered', 'Waitlisted', 'Cancelled'];
const PAYMENT_STATUS_FILTERS = ['All', 'Pending', 'Paid', 'Refunded'];

function RegistrationPanel({ canManageEvents = false, currentUserProfile }) {
  const [error, setError] = useState('');
  const [eventFilter, setEventFilter] = useState('all');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [paymentFilter, setPaymentFilter] = useState('All');
  const [registrationStatusFilter, setRegistrationStatusFilter] = useState('All');
  const [registrations, setRegistrations] = useState([]);
  const [savingRegistrationId, setSavingRegistrationId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRegistrationId, setSelectedRegistrationId] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [users, setUsers] = useState([]);

  useEffect(() => {
    let pendingLoads = 3;
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
    const unsubscribeEvents = (
      canManageEvents ? subscribeToAdminEvents : subscribeToPublishedEvents
    )(
      (snapshot) => {
        setEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
        markLoaded();
      },
      handleError
    );
    const unsubscribeRegistrations = subscribeToRegistrations(
      (snapshot) => {
        setRegistrations(snapshot.docs.map((registrationDoc) => ({
          id: registrationDoc.id,
          ...registrationDoc.data()
        })));
        markLoaded();
      },
      handleError
    );
    const unsubscribeUsers = subscribeToUsers(
      (snapshot) => {
        setUsers(snapshot.docs.map((userDoc) => ({ id: userDoc.id, ...userDoc.data() })));
        markLoaded();
      },
      handleError,
      { includeAdminProfiles: false }
    );

    return () => {
      unsubscribeEvents();
      unsubscribeRegistrations();
      unsubscribeUsers();
    };
  }, [canManageEvents]);

  const eventMap = useMemo(
    () => new Map(events.map((event) => [event.id, event])),
    [events]
  );
  const userMap = useMemo(() => {
    const byEmail = new Map();
    const byId = new Map();

    users.forEach((user) => {
      if (user.userId || user.id) {
        byId.set(user.userId || user.id, user);
      }

      if (user.email) {
        byEmail.set(normalizeEmail(user.email), user);
      }
    });

    return { byEmail, byId };
  }, [users]);
  const registrationSummary = useMemo(
    () => registrations.reduce(
      (counts, registration) => {
        counts.total += 1;
        if (registration.status === 'Registered') {
          counts.registered += 1;
        } else if (registration.status === 'Waitlisted') {
          counts.waitlisted += 1;
        } else if (registration.status === 'Cancelled') {
          counts.cancelled += 1;
        }

        if (registration.paymentStatus === 'Paid') {
          counts.paid += 1;
        } else if (registration.paymentStatus === 'Refunded') {
          counts.refunded += 1;
        } else {
          counts.pending += 1;
        }

        return counts;
      },
      { cancelled: 0, paid: 0, pending: 0, refunded: 0, registered: 0, total: 0, waitlisted: 0 }
    ),
    [registrations]
  );
  const filteredRegistrations = useMemo(
    () =>
      registrations.filter((registration) => {
        if (eventFilter !== 'all' && registration.eventId !== eventFilter) {
          return false;
        }

        if (
          registrationStatusFilter !== 'All'
          && registration.status !== registrationStatusFilter
        ) {
          return false;
        }

        if (paymentFilter !== 'All' && registration.paymentStatus !== paymentFilter) {
          return false;
        }

        const event = eventMap.get(registration.eventId);
        const user =
          userMap.byId.get(registration.userId)
          || userMap.byEmail.get(normalizeEmail(registration.email));
        const haystack = [
          registration.eventTitle,
          registration.eventType,
          registration.name,
          registration.registrantFirstName,
          registration.registrantLastName,
          registration.email,
          registration.phone,
          registration.status,
          registration.paymentStatus,
          registration.membershipStatusAtRegistration,
          event?.title,
          event?.eventType,
          user?.membershipStatus
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();

        return !searchTerm.trim() || haystack.includes(searchTerm.trim().toLowerCase());
      }),
    [
      eventFilter,
      eventMap,
      paymentFilter,
      registrationStatusFilter,
      registrations,
      searchTerm,
      userMap.byEmail,
      userMap.byId
    ]
  );
  const groupedRegistrations = useMemo(() => {
    const groups = new Map();

    filteredRegistrations.forEach((registration) => {
      const existing = groups.get(registration.eventId) || [];
      existing.push(registration);
      groups.set(registration.eventId, existing);
    });

    return [...groups.entries()]
      .map(([eventId, eventRegistrations]) => {
        const event = eventMap.get(eventId);
        const counts = eventRegistrations.reduce(
          (summary, registration) => {
            if (registration.status === 'Registered') {
              summary.registered += 1;
            } else if (registration.status === 'Waitlisted') {
              summary.waitlisted += 1;
            } else if (registration.status === 'Cancelled') {
              summary.cancelled += 1;
            }

            return summary;
          },
          { cancelled: 0, registered: 0, waitlisted: 0 }
        );

        return {
          counts,
          event,
          eventId,
          snapshot: eventRegistrations[0] || {},
          registrations: eventRegistrations.sort(compareRegistrationDates)
        };
      })
      .sort((first, second) => {
        const firstDate = getEventSortValue(first.event);
        const secondDate = getEventSortValue(second.event);

        if (firstDate !== secondDate) {
          return firstDate - secondDate;
        }

        return getEventDisplayTitle(first.event, first.eventId).localeCompare(
          getEventDisplayTitle(second.event, second.eventId)
        );
      });
  }, [eventMap, filteredRegistrations]);
  const eventOptions = useMemo(
    () => [
      { label: 'All Events / Activities', value: 'all' },
      ...events
        .map((event) => ({
          label: `${event.title || event.eventType || event.id} (${formatEventDate(event.date)})`,
          value: event.id
        }))
        .sort((first, second) => first.label.localeCompare(second.label))
    ],
    [events]
  );
  const selectedRegistration = useMemo(
    () => registrations.find((registration) => registration.id === selectedRegistrationId) || null,
    [registrations, selectedRegistrationId]
  );
  const selectedRegistrationEvent = selectedRegistration
    ? eventMap.get(selectedRegistration.eventId)
    : null;
  const selectedRegistrationUser = selectedRegistration
    ? userMap.byId.get(selectedRegistration.userId)
      || userMap.byEmail.get(normalizeEmail(selectedRegistration.email))
    : null;

  function handleResetFilters() {
    setEventFilter('all');
    setRegistrationStatusFilter('All');
    setPaymentFilter('All');
    setSearchTerm('');
  }

  function handleOpenDetails(registration) {
    setError('');
    setSuccessMessage('');
    setSelectedRegistrationId(registration.id);
    setSelectedStatus(registration.status || 'Registered');
  }

  function handleCloseDetails() {
    if (savingRegistrationId) {
      return;
    }

    setSelectedRegistrationId('');
    setSelectedStatus('');
  }

  async function handleSaveStatus() {
    const nextStatus = selectedStatus;

    if (!selectedRegistration || !nextStatus || nextStatus === selectedRegistration.status) {
      return;
    }

    setError('');
    setSuccessMessage('');
    setSavingRegistrationId(selectedRegistration.id);

    try {
      await updateRegistrationStatus(selectedRegistration.id, nextStatus, currentUserProfile);
      setSuccessMessage('Registration updated.');
      setSelectedRegistrationId('');
      setSelectedStatus('');
    } catch (saveError) {
      setError(saveError.message || 'Registration could not be updated.');
    } finally {
      setSavingRegistrationId('');
    }
  }

  if (loading) {
    return (
      <section className="admin-list-panel">
        <div className="empty-state">
          <h2>Loading Registrations</h2>
          <p>Retrieving registration records from Firestore.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-list-panel" id="registrations-card">
      <div className="form-section-header form-section-header-stacked">
        <div className="form-section-header-top">
          <h2>Registrations</h2>
          <span>{filteredRegistrations.length} shown</span>
        </div>
      </div>
      <div className="configuration-summary" aria-label="Registration totals">
        <span>Total: {registrationSummary.total}</span>
        <span>Registered: {registrationSummary.registered}</span>
        <span>Waitlisted: {registrationSummary.waitlisted}</span>
        <span>Cancelled: {registrationSummary.cancelled}</span>
        <span>Pending Payment: {registrationSummary.pending}</span>
        <span>Paid: {registrationSummary.paid}</span>
      </div>
      <div className="registration-admin-controls">
        <label>
          <span>Event / Activity</span>
          <select value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
            {eventOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Registration Status</span>
          <select
            value={registrationStatusFilter}
            onChange={(event) => setRegistrationStatusFilter(event.target.value)}
          >
            {REGISTRATION_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Payment Status</span>
          <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
            {PAYMENT_STATUS_FILTERS.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="registration-search-label">
          <span>Search Registrations</span>
          <input
            type="search"
            placeholder="Search event, registrant, email, phone, or membership"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
          />
        </label>
        <div className="registration-filter-actions">
          <button
            className="button-link button-reset secondary-action compact-action"
            type="button"
            onClick={handleResetFilters}
          >
            Reset Filters
          </button>
        </div>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      {!groupedRegistrations.length ? (
        <div className="empty-state compact-empty-state">
          <h2>No matching registrations</h2>
          <p>Try a different event, status, or search filter.</p>
        </div>
      ) : null}
      <div className="registration-admin-list">
        {groupedRegistrations.map((group) => {
          const eventTitle = getEventDisplayTitle(group.event, group.eventId, group.snapshot);
          const capacitySummary = getCapacitySummary(group.event, group.counts.registered);

          return (
            <article className="registration-admin-card" key={group.eventId}>
              <div className="registration-admin-card-header">
                <div>
                  <div className="card-kicker">
                    <span>{group.event?.eventType || group.snapshot.eventType || 'Event / Activity'}</span>
                    <strong>{group.registrations.length} total registrations</strong>
                  </div>
                  <h3>{eventTitle}</h3>
                  <p>
                    {formatEventDate(group.event?.date || group.snapshot.eventDate)}
                    {group.event?.location ? ` | ${group.event.location}` : ''}
                  </p>
                </div>
                <div className="registration-admin-metrics">
                  <span className="registration-capacity-pill">{capacitySummary}</span>
                  <span><strong>{group.counts.registered}</strong> Registered</span>
                  <span><strong>{group.counts.waitlisted}</strong> Waitlisted</span>
                  <span><strong>{group.counts.cancelled}</strong> Cancelled</span>
                </div>
              </div>
              <div className="user-table-wrap">
                <table className="user-table registration-table">
                  <thead>
                    <tr>
                      <th>Registrant</th>
                      <th>Registered</th>
                      <th>Membership</th>
                      <th>Registration Status</th>
                      <th>Payment</th>
                      <th>Profile</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.registrations.map((registration) => {
                      const user =
                        userMap.byId.get(registration.userId)
                        || userMap.byEmail.get(normalizeEmail(registration.email));

                      return (
                        <tr key={registration.id}>
                          <td data-label="Registrant">
                            <strong>{registration.name || 'Registrant'}</strong>
                            <span>{registration.email || 'No email'}</span>
                          </td>
                          <td data-label="Registered">{formatDateTime(registration.registrationDate)}</td>
                          <td data-label="Membership">{user?.membershipStatus || 'Unknown'}</td>
                          <td data-label="Registration Status">{registration.status || 'Registered'}</td>
                          <td data-label="Payment">{registration.paymentStatus || 'Pending'}</td>
                          <td data-label="Profile">
                            {registration.userId ? 'Matched Profile' : 'Guest / Email Only'}
                          </td>
                          <td data-label="Actions">
                            <div className="card-actions">
                              <button
                                className="button-link button-reset secondary-action compact-action"
                                type="button"
                                onClick={() => handleOpenDetails(registration)}
                              >
                                Details/Edit
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </article>
          );
        })}
      </div>
      {selectedRegistration ? (
        <div
          aria-labelledby="registration-details-title"
          aria-modal="true"
          className="registration-modal-backdrop"
          role="dialog"
        >
          <div className="registration-modal-card">
            <div className="form-section-header form-section-header-stacked">
              <div className="form-section-header-top">
                <div>
                  <h2 id="registration-details-title">Registration Details</h2>
                  <p className="section-helper">
                    Review the registration and update the status when needed.
                  </p>
                </div>
                <button
                  className="button-link button-reset secondary-action compact-action"
                  disabled={Boolean(savingRegistrationId)}
                  type="button"
                  onClick={handleCloseDetails}
                >
                  Cancel
                </button>
              </div>
            </div>
            <div className="registration-detail-grid">
              <DetailItem
                label="Event / Activity"
                value={getEventDisplayTitle(
                  selectedRegistrationEvent,
                  selectedRegistration.eventId,
                  selectedRegistration
                )}
              />
              <DetailItem label="Event Type" value={selectedRegistrationEvent?.eventType || selectedRegistration.eventType || 'Event / Activity'} />
              <DetailItem label="Event Date" value={formatEventDate(selectedRegistrationEvent?.date || selectedRegistration.eventDate)} />
              <DetailItem label="Registrant" value={selectedRegistration.name || 'Registrant'} />
              <DetailItem label="Email" value={selectedRegistration.email || 'No email'} />
              <DetailItem label="Phone" value={selectedRegistration.phone || 'No phone'} />
              <DetailItem label="Registered Date" value={formatDateTime(selectedRegistration.registrationDate)} />
              <DetailItem label="Membership Status" value={selectedRegistrationUser?.membershipStatus || 'Unknown'} />
              <DetailItem
                label="Membership When Registered"
                value={selectedRegistration.membershipStatusAtRegistration || 'Unknown'}
              />
              <DetailItem label="Payment Status" value={selectedRegistration.paymentStatus || 'Pending'} />
              <DetailItem
                label="Profile"
                value={selectedRegistration.userId ? 'Matched Profile' : 'Guest / Email Only'}
              />
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <label className="registration-modal-status">
              <span>Registration Status</span>
              <select
                className="registration-status-select"
                value={selectedStatus}
                onChange={(event) => setSelectedStatus(event.target.value)}
              >
                {REGISTRATION_STATUS_FILTERS.filter((status) => status !== 'All').map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </label>
            <div className="form-actions">
              <button
                className="button-link button-reset"
                disabled={
                  savingRegistrationId === selectedRegistration.id
                  || selectedStatus === selectedRegistration.status
                }
                type="button"
                onClick={handleSaveStatus}
              >
                {savingRegistrationId === selectedRegistration.id ? 'Saving...' : 'Save Status'}
              </button>
              <button
                className="button-link button-reset secondary-action"
                disabled={Boolean(savingRegistrationId)}
                type="button"
                onClick={handleCloseDetails}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function DetailItem({ label, value }) {
  return (
    <div className="registration-detail-item">
      <dt>{label}</dt>
      <dd>{value || 'Not Set'}</dd>
    </div>
  );
}

function compareRegistrationDates(first, second) {
  return getTimestampValue(second.registrationDate) - getTimestampValue(first.registrationDate);
}

function getTimestampValue(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatDateTime(value) {
  if (!value) {
    return 'Not Set';
  }

  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not Set' : date.toLocaleString();
}

function getEventSortValue(event) {
  if (!event?.date) {
    return Number.MAX_SAFE_INTEGER;
  }

  const parsed = Date.parse(event.date);
  return Number.isNaN(parsed) ? Number.MAX_SAFE_INTEGER : parsed;
}

function getEventDisplayTitle(event, eventId, registrationSnapshot = {}) {
  return event?.title || registrationSnapshot.eventTitle || event?.eventType || registrationSnapshot.eventType || eventId;
}

function getCapacitySummary(event, registeredCount) {
  if (!event) {
    return 'Capacity unavailable';
  }

  if (event.capacityUnlimited) {
    return 'Unlimited capacity';
  }

  const capacity = Number(event.capacity || 0);

  if (!capacity) {
    return 'Capacity not set';
  }

  const remaining = capacity - registeredCount;

  if (remaining < 0) {
    return `${registeredCount}/${capacity} filled (over by ${Math.abs(remaining)})`;
  }

  return `${registeredCount}/${capacity} filled (${remaining} open)`;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export default RegistrationPanel;
