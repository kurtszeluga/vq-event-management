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
  const [registrationEdits, setRegistrationEdits] = useState({});
  const [registrationStatusFilter, setRegistrationStatusFilter] = useState('All');
  const [registrations, setRegistrations] = useState([]);
  const [savingRegistrationId, setSavingRegistrationId] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
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
          registration.name,
          registration.email,
          registration.phone,
          registration.status,
          registration.paymentStatus,
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

  async function handleSaveStatus(registration) {
    const nextStatus = registrationEdits[registration.id];

    if (!nextStatus || nextStatus === registration.status) {
      return;
    }

    setError('');
    setSuccessMessage('');
    setSavingRegistrationId(registration.id);

    try {
      await updateRegistrationStatus(registration.id, nextStatus, currentUserProfile);
      setRegistrationEdits((current) => {
        const next = { ...current };
        delete next[registration.id];
        return next;
      });
      setSuccessMessage('Registration updated.');
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
          const eventTitle = getEventDisplayTitle(group.event, group.eventId);
          const capacitySummary = getCapacitySummary(group.event, group.counts.registered);

          return (
            <article className="registration-admin-card" key={group.eventId}>
              <div className="registration-admin-card-header">
                <div>
                  <div className="card-kicker">
                    <span>{group.event?.eventType || 'Event / Activity'}</span>
                    <strong>{group.registrations.length} total registrations</strong>
                  </div>
                  <h3>{eventTitle}</h3>
                  <p>
                    {formatEventDate(group.event?.date)}
                    {group.event?.location ? ` | ${group.event.location}` : ''}
                  </p>
                </div>
                <div className="registration-admin-metrics">
                  <span>{capacitySummary}</span>
                  <span>Registered: {group.counts.registered}</span>
                  <span>Waitlisted: {group.counts.waitlisted}</span>
                  <span>Cancelled: {group.counts.cancelled}</span>
                </div>
              </div>
              <div className="user-table-wrap">
                <table className="user-table registration-table">
                  <thead>
                    <tr>
                      <th>Registrant</th>
                      <th>Phone</th>
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
                      const nextStatus = registrationEdits[registration.id] || registration.status;
                      const hasChanged = nextStatus !== registration.status;

                      return (
                        <tr key={registration.id}>
                          <td data-label="Registrant">
                            <strong>{registration.name || 'Registrant'}</strong>
                            <span>{registration.email || 'No email'}</span>
                          </td>
                          <td data-label="Phone">{registration.phone || 'No phone'}</td>
                          <td data-label="Registered">{formatDateTime(registration.registrationDate)}</td>
                          <td data-label="Membership">{user?.membershipStatus || 'Unknown'}</td>
                          <td data-label="Registration Status">
                            <select
                              className="registration-status-select"
                              value={nextStatus}
                              onChange={(event) =>
                                setRegistrationEdits((current) => ({
                                  ...current,
                                  [registration.id]: event.target.value
                                }))
                              }
                            >
                              {REGISTRATION_STATUS_FILTERS.filter((status) => status !== 'All').map((status) => (
                                <option key={status} value={status}>
                                  {status}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td data-label="Payment">{registration.paymentStatus || 'Pending'}</td>
                          <td data-label="Profile">
                            {registration.userId ? 'Matched Profile' : 'Guest / Email Only'}
                          </td>
                          <td data-label="Actions">
                            <div className="card-actions">
                              <button
                                className="button-link button-reset secondary-action compact-action"
                                disabled={!hasChanged || savingRegistrationId === registration.id}
                                type="button"
                                onClick={() => handleSaveStatus(registration)}
                              >
                                {savingRegistrationId === registration.id ? 'Saving...' : 'Save Status'}
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
    </section>
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

function getEventDisplayTitle(event, eventId) {
  return event?.title || event?.eventType || eventId;
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
