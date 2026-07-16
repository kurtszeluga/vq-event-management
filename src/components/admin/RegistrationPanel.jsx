import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  subscribeToAdminEvents,
  subscribeToPublishedEvents
} from '../../services/eventService.js';
import {
  subscribeToRegistrations,
  updateRegistrationPayment
} from '../../services/registrationService.js';
import { subscribeToUsers } from '../../services/userService.js';
import { formatEventDate } from '../../utils/eventFormat.js';

const REGISTRATION_STATUS_FILTERS = ['All', 'Registered', 'Waitlisted', 'Cancelled'];
const PAYMENT_STATUS_FILTERS = ['All', 'Pending', 'Paid', 'Refunded', 'Failed', 'Waived'];
const MANUAL_PAYMENT_METHOD_OPTIONS = ['Cash', 'Check'];
const ACTIVITY_FILTERS = ['Programs', 'Workshops', 'Retreat', 'Challenges'];
const QUARTER_FILTERS = [
  { label: 'All Quarters', value: '' },
  { label: 'Q1 (Jan-March)', value: 'Q1' },
  { label: 'Q2 (April-June)', value: 'Q2' },
  { label: 'Q3 (July-Sept)', value: 'Q3' },
  { label: 'Q4 (Oct-Dec)', value: 'Q4' }
];
const DEFAULT_YEAR_FILTER = String(new Date().getFullYear());
const DEFAULT_QUARTER_FILTER = getQuarterFilterValue(new Date());

function RegistrationPanel({ canManageEvents = false, currentUserProfile }) {
  const [activityFilter, setActivityFilter] = useState('');
  const [error, setError] = useState('');
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [quarterFilter, setQuarterFilter] = useState(DEFAULT_QUARTER_FILTER);
  const [registrations, setRegistrations] = useState([]);
  const [registrationSortConfig, setRegistrationSortConfig] = useState({
    direction: 'asc',
    key: 'registrant'
  });
  const [savingRegistrationId, setSavingRegistrationId] = useState('');
  const [expandedRegistrationId, setExpandedRegistrationId] = useState('');
  const [selectedEventId, setSelectedEventId] = useState('');
  const [selectedRegistrationId, setSelectedRegistrationId] = useState('');
  const [selectedPaymentAmount, setSelectedPaymentAmount] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('None');
  const [selectedPaymentNote, setSelectedPaymentNote] = useState('');
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState('Pending');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [users, setUsers] = useState([]);
  const [yearFilter, setYearFilter] = useState(DEFAULT_YEAR_FILTER);

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
  const filteredEvents = useMemo(
    () =>
      events.filter((event) => {
        if (
          activityFilter
          && getActivityFilterValue(event.eventType) !== activityFilter
        ) {
          return false;
        }

        if (
          quarterFilter
          && getQuarterFilterValue(event.date) !== quarterFilter
        ) {
          return false;
        }

        if (
          yearFilter
          && getYearFilterValue(event.date) !== yearFilter
        ) {
          return false;
        }

        return true;
      }),
    [activityFilter, events, quarterFilter, yearFilter]
  );
  const groupedRegistrations = useMemo(() => {
    const groups = new Map();

    registrations.forEach((registration) => {
      const existing = groups.get(registration.eventId) || [];
      existing.push(registration);
      groups.set(registration.eventId, existing);
    });

    return filteredEvents
      .map((event) => {
        const eventId = event.id;
        const eventRegistrations = groups.get(eventId) || [];
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
        const displayRegistrations = combineRegistrationsByRegistrant(eventRegistrations);
        const displayCounts = displayRegistrations.reduce(
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
          displayCounts,
          displayRegistrationCount: displayRegistrations.length,
          event,
          eventId,
          rawRegistrationCount: eventRegistrations.length,
          snapshot: eventRegistrations[0] || {},
          registrations: eventRegistrations.sort(compareRegistrationDates)
        };
      })
      .sort((first, second) => {
        const firstDate = getEventSortValue(first.event);
        const secondDate = getEventSortValue(second.event);

        if (firstDate !== secondDate) {
          return secondDate - firstDate;
        }

        return getEventDisplayTitle(first.event, first.eventId).localeCompare(
          getEventDisplayTitle(second.event, second.eventId)
        );
      });
  }, [filteredEvents, registrations]);
  const activityCounts = useMemo(() => {
    const counts = Object.fromEntries(ACTIVITY_FILTERS.map((filter) => [filter, 0]));
    const eventIdsByFilter = Object.fromEntries(ACTIVITY_FILTERS.map((filter) => [filter, new Set()]));

    events.forEach((event) => {
      const eventDate = event.date;

      if (yearFilter && getYearFilterValue(eventDate) !== yearFilter) {
        return;
      }

      if (quarterFilter && getQuarterFilterValue(eventDate) !== quarterFilter) {
        return;
      }

      const filterValue = getActivityFilterValue(event.eventType);

      if (filterValue && eventIdsByFilter[filterValue]) {
        eventIdsByFilter[filterValue].add(event.id);
      }
    });

    Object.entries(eventIdsByFilter).forEach(([filter, eventIds]) => {
      counts[filter] = eventIds.size;
    });

    return counts;
  }, [events, quarterFilter, yearFilter]);
  const quarterCounts = useMemo(() => {
    const counts = Object.fromEntries(QUARTER_FILTERS.map((filter) => [filter.value, 0]));
    const eventIdsByFilter = Object.fromEntries(QUARTER_FILTERS.map((filter) => [filter.value, new Set()]));

    events.forEach((event) => {
      if (
        activityFilter
        && getActivityFilterValue(event.eventType) !== activityFilter
      ) {
        return;
      }

      const eventDate = event.date;

      if (yearFilter && getYearFilterValue(eventDate) !== yearFilter) {
        return;
      }

      const filterValue = getQuarterFilterValue(eventDate);

      if (filterValue && eventIdsByFilter[filterValue]) {
        eventIdsByFilter[filterValue].add(event.id);
        eventIdsByFilter[''].add(event.id);
      }
    });

    Object.entries(eventIdsByFilter).forEach(([filter, eventIds]) => {
      counts[filter] = eventIds.size;
    });

    return counts;
  }, [activityFilter, events, yearFilter]);
  const yearOptions = useMemo(() => {
    const years = new Set();

    events.forEach((event) => {
      const year = getYearFilterValue(event.date);

      if (year) {
        years.add(year);
      }
    });

    return [...years].sort((first, second) => Number(second) - Number(first));
  }, [events]);
  const selectedRegistration = useMemo(
    () => registrations.find((registration) => registration.id === selectedRegistrationId) || null,
    [registrations, selectedRegistrationId]
  );
  const selectedEventGroup = useMemo(
    () => groupedRegistrations.find((group) => group.eventId === selectedEventId) || null,
    [groupedRegistrations, selectedEventId]
  );
  const selectedDisplayRegistrations = useMemo(
    () => sortRegistrationsForDisplay(
      combineRegistrationsByRegistrant(selectedEventGroup?.registrations || []),
      registrationSortConfig,
      userMap
    ),
    [registrationSortConfig, selectedEventGroup, userMap]
  );
  const selectedRegistrationEvent = selectedRegistration
    ? eventMap.get(selectedRegistration.eventId)
    : null;
  const selectedRegistrationUser = selectedRegistration
    ? userMap.byId.get(selectedRegistration.userId)
      || userMap.byEmail.get(normalizeEmail(selectedRegistration.email))
    : null;
  const paymentEditState = getPaymentEditState(selectedRegistration, selectedPaymentStatus);
  const paymentMethodOptions = getPaymentMethodOptions(selectedRegistration, selectedPaymentStatus);
  const paymentStatusOptions = getPaymentStatusOptions(selectedRegistration);

  function handleResetFilters() {
    setActivityFilter('');
    setQuarterFilter(DEFAULT_QUARTER_FILTER);
    setSelectedEventId('');
    setExpandedRegistrationId('');
    setYearFilter(DEFAULT_YEAR_FILTER);
  }

  function handleActivityFilter(nextFilter) {
    setActivityFilter((currentFilter) => (currentFilter === nextFilter ? '' : nextFilter));
    setSelectedEventId('');
    setExpandedRegistrationId('');
  }

  function handleQuarterFilter(nextFilter) {
    setQuarterFilter((currentFilter) => (currentFilter === nextFilter ? '' : nextFilter));
    setSelectedEventId('');
    setExpandedRegistrationId('');
  }

  function handleYearFilter(nextYear) {
    setYearFilter(nextYear);
    setSelectedEventId('');
    setExpandedRegistrationId('');
  }

  function handleSelectEvent(eventId) {
    setSelectedEventId(eventId);
    setExpandedRegistrationId('');
  }

  function handleBackToEvents() {
    setSelectedEventId('');
    setExpandedRegistrationId('');
  }

  function handleRegistrationSort(sortKey) {
    setRegistrationSortConfig((currentConfig) => ({
      direction: currentConfig.key === sortKey && currentConfig.direction === 'asc' ? 'desc' : 'asc',
      key: sortKey
    }));
  }

  function handleToggleDetails(registrationId) {
    setExpandedRegistrationId((currentId) => (currentId === registrationId ? '' : registrationId));
  }

  function handleOpenEdit(registration) {
    setError('');
    setSuccessMessage('');
    setSelectedRegistrationId(registration.id);
    setSelectedStatus(registration.status || 'Registered');
    setSelectedPaymentAmount(String(registration.amountPaid ?? ''));
    setSelectedPaymentMethod(registration.paymentMethod || 'None');
    setSelectedPaymentNote(registration.paymentNote || '');
    setSelectedPaymentStatus(registration.paymentStatus || 'Pending');
  }

  function handlePaymentStatusChange(nextStatus) {
    setSelectedPaymentStatus(nextStatus);

    if (nextStatus === 'Pending') {
      setSelectedPaymentMethod('None');
      setSelectedPaymentAmount('0');
      return;
    }

    if (nextStatus === 'Waived') {
      setSelectedPaymentMethod('Comped');
      setSelectedPaymentAmount('0');
      return;
    }

    if (nextStatus === 'Refunded') {
      setSelectedPaymentMethod(selectedRegistration?.paymentMethod || 'None');
      setSelectedPaymentAmount(String(selectedRegistration?.amountPaid ?? 0));
      return;
    }

    if (nextStatus === 'Paid') {
      if (isOnlinePayment(selectedRegistration)) {
        setSelectedPaymentMethod('Online');
      } else if (!MANUAL_PAYMENT_METHOD_OPTIONS.includes(selectedPaymentMethod)) {
        setSelectedPaymentMethod('Cash');
      }

      if (!Number(selectedPaymentAmount || 0)) {
        setSelectedPaymentAmount(String(getAmountDue(selectedRegistration || {})));
      }
    }
  }

  function handleCloseDetails() {
    if (savingRegistrationId) {
      return;
    }

    setSelectedRegistrationId('');
    setSelectedPaymentAmount('');
    setSelectedPaymentMethod('None');
    setSelectedPaymentNote('');
    setSelectedPaymentStatus('Pending');
    setSelectedStatus('');
  }

  async function handleSaveChanges() {
    if (!selectedRegistration) {
      return;
    }

    const statusChanged = selectedStatus !== selectedRegistration.status;
    const nextPayment = normalizePaymentEdit(selectedRegistration, {
      amountPaid: selectedPaymentAmount,
      paymentMethod: selectedPaymentMethod,
      paymentNote: selectedPaymentNote.trim(),
      paymentStatus: selectedPaymentStatus
    });

    if (nextPayment.error) {
      setError(nextPayment.error);
      setSuccessMessage('');
      return;
    }

    const paymentChanged = hasPaymentChanged(selectedRegistration, nextPayment.payment);

    if (!statusChanged && !paymentChanged) {
      return;
    }

    setError('');
    setSuccessMessage('');
    setSavingRegistrationId(selectedRegistration.id);

    try {
      await updateRegistrationPayment(
        selectedRegistration.id,
        {
          ...nextPayment.payment,
          status: selectedStatus
        },
        currentUserProfile
      );

      setSuccessMessage('Registration changes saved.');
      setSelectedRegistrationId('');
      setSelectedPaymentAmount('');
      setSelectedPaymentMethod('None');
      setSelectedPaymentNote('');
      setSelectedPaymentStatus('Pending');
      setSelectedStatus('');
    } catch (saveError) {
      setError(saveError.message || 'Registration changes could not be saved.');
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
          <span>
            {selectedEventGroup
              ? `${selectedDisplayRegistrations.length} registrants shown`
              : `${groupedRegistrations.length} events shown`}
          </span>
        </div>
      </div>
      <div className="registration-activity-filters" aria-label="Registration activity filters">
        {ACTIVITY_FILTERS.map((filter) => (
          <button
            className={`status-filter-button${activityFilter === filter ? ' active' : ''}`}
            key={filter}
            type="button"
            onClick={() => handleActivityFilter(filter)}
          >
            {filter} ({activityCounts[filter] || 0})
          </button>
        ))}
      </div>
      <div className="registration-quarter-filters" aria-label="Registration quarter filters">
        <label className="registration-year-filter">
          <span>Year</span>
          <select value={yearFilter} onChange={(event) => handleYearFilter(event.target.value)}>
            <option value="">All Years</option>
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        {QUARTER_FILTERS.map((filter) => (
          <button
            className={`status-filter-button${quarterFilter === filter.value ? ' active' : ''}`}
            key={filter.value}
            type="button"
            onClick={() => handleQuarterFilter(filter.value)}
          >
            {filter.label} ({quarterCounts[filter.value] || 0})
          </button>
        ))}
        <button
          className="button-link button-reset secondary-action compact-action registration-reset-button"
          type="button"
          onClick={handleResetFilters}
        >
          Reset Filters
        </button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      {successMessage ? <p className="form-success">{successMessage}</p> : null}
      {!groupedRegistrations.length ? (
        <div className="empty-state compact-empty-state">
          <h2>No matching events</h2>
          <p>Try a different activity, year, or quarter filter.</p>
        </div>
      ) : null}
      <div className="registration-admin-list">
        {groupedRegistrations.length && !selectedEventGroup ? (
          groupedRegistrations.map((group) => {
            const eventTitle = getEventDisplayTitle(group.event, group.eventId, group.snapshot);

            return (
              <button
                className="registration-event-card"
                key={group.eventId}
                type="button"
                onClick={() => handleSelectEvent(group.eventId)}
              >
                <div className="registration-event-card-main">
                  <div className="card-kicker">
                    <span>{group.event?.eventType || group.snapshot.eventType || 'Event / Activity'}</span>
                    <strong>
                      {group.displayRegistrationCount} registrant{group.displayRegistrationCount === 1 ? '' : 's'}
                      {group.rawRegistrationCount !== group.displayRegistrationCount
                        ? ` (${group.rawRegistrationCount} records)`
                        : ''}
                    </strong>
                  </div>
                  <h3>{eventTitle}</h3>
                  <p>
                    {formatEventDate(group.event?.date || group.snapshot.eventDate)}
                    {group.event?.location ? ` | ${group.event.location}` : ''}
                  </p>
                </div>
                <div className="registration-event-stats">
                  <span className={getStatPillClass(getCapacitySummaryCount(group.event, group.displayCounts.registered))}>
                    {getCapacitySummary(group.event, group.displayCounts.registered)}
                  </span>
                  <span className={getStatPillClass(group.displayCounts.registered)}>
                    {group.displayCounts.registered} Registered
                  </span>
                  <span className={getStatPillClass(group.displayCounts.waitlisted)}>
                    {group.displayCounts.waitlisted} Waitlisted
                  </span>
                  <span className={getStatPillClass(group.displayCounts.cancelled)}>
                    {group.displayCounts.cancelled} Cancelled
                  </span>
                </div>
              </button>
            );
          })
        ) : null}
        {selectedEventGroup ? [selectedEventGroup].map((group) => {
          const eventTitle = getEventDisplayTitle(group.event, group.eventId, group.snapshot);

          return (
            <article className="registration-admin-card" key={group.eventId}>
              <div className="registration-admin-card-header">
                <div>
                  <div className="card-kicker">
                    <span>{group.event?.eventType || group.snapshot.eventType || 'Event / Activity'}</span>
                    <strong>
                      {group.displayRegistrationCount} registrant{group.displayRegistrationCount === 1 ? '' : 's'}
                      {group.rawRegistrationCount !== group.displayRegistrationCount
                        ? ` (${group.rawRegistrationCount} records)`
                        : ''}
                    </strong>
                  </div>
                  <h3>{eventTitle}</h3>
                  <p>
                    {formatEventDate(group.event?.date || group.snapshot.eventDate)}
                    {group.event?.location ? ` | ${group.event.location}` : ''}
                  </p>
                </div>
                <button
                  className="button-link button-reset secondary-action compact-action"
                  type="button"
                  onClick={handleBackToEvents}
                >
                  Back To Events
                </button>
              </div>
              <div className="user-table-wrap">
                {selectedDisplayRegistrations.length ? (
                  <table className="user-table registration-table">
                    <thead>
                      <tr>
                        <SortableHeader
                          label="Registrant"
                          sortKey="registrant"
                          sortConfig={registrationSortConfig}
                          onSort={handleRegistrationSort}
                        />
                        <SortableHeader
                          label="Registered"
                          sortKey="registeredDate"
                          sortConfig={registrationSortConfig}
                          onSort={handleRegistrationSort}
                        />
                        <SortableHeader
                          label="Membership"
                          sortKey="membership"
                          sortConfig={registrationSortConfig}
                          onSort={handleRegistrationSort}
                        />
                        <SortableHeader
                          label="Registration Status"
                          sortKey="status"
                          sortConfig={registrationSortConfig}
                          onSort={handleRegistrationSort}
                        />
                        <SortableHeader
                          label="Payment"
                          sortKey="payment"
                          sortConfig={registrationSortConfig}
                          onSort={handleRegistrationSort}
                        />
                        <SortableHeader
                          label="Profile"
                          sortKey="profile"
                          sortConfig={registrationSortConfig}
                          onSort={handleRegistrationSort}
                        />
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDisplayRegistrations.map((registration) => {
                      const user =
                        userMap.byId.get(registration.userId)
                        || userMap.byEmail.get(normalizeEmail(registration.email));
                      const isExpanded = expandedRegistrationId === registration.id;

                      return (
                        <Fragment key={registration.id}>
                          <tr>
                            <td data-label="Registrant">
                              <strong>{registration.name || 'Registrant'}</strong>
                              <span>{registration.email || 'No email'}</span>
                              {registration.combinedCount > 1 ? (
                                <span>{registration.combinedCount} registration records combined</span>
                              ) : null}
                            </td>
                            <td data-label="Registered">{formatDateTime(registration.registrationDate)}</td>
                            <td data-label="Membership">{user?.membershipStatus || 'Unknown'}</td>
                            <td data-label="Registration Status">{registration.status || 'Registered'}</td>
                            <td data-label="Payment">{formatPaymentSummary(registration)}</td>
                            <td data-label="Profile">
                              {registration.userId ? 'Matched Profile' : 'Guest / Email Only'}
                            </td>
                            <td data-label="Actions">
                              <div className="card-actions">
                                <button
                                  className="button-link button-reset secondary-action compact-action"
                                  type="button"
                                  onClick={() => handleToggleDetails(registration.id)}
                                >
                                  {isExpanded ? 'Hide Details' : 'Details'}
                                </button>
                                <button
                                  className="button-link button-reset secondary-action compact-action"
                                  type="button"
                                  onClick={() => handleOpenEdit(registration)}
                                >
                                  Edit
                                </button>
                              </div>
                            </td>
                          </tr>
                          {isExpanded ? (
                            <tr className="registration-detail-row">
                              <td colSpan="7">
                                <div className="registration-inline-details">
                                  <div className="registration-detail-summary">
                                    <div>
                                      <span>{getCapacitySummary(group.event, group.displayCounts.registered)}</span>
                                      <span>{group.displayCounts.registered} Active Registrants</span>
                                      <span>{group.displayCounts.waitlisted} Waitlisted</span>
                                      <span>{group.displayCounts.cancelled} Cancelled Registrants</span>
                                      <span>{group.rawRegistrationCount} Total Records</span>
                                    </div>
                                  </div>
                                  <dl className="registration-detail-grid">
                                    <DetailItem
                                      label="Event / Activity"
                                      value={getEventDisplayTitle(group.event, group.eventId, registration)}
                                    />
                                    <DetailItem
                                      label="Event Type"
                                      value={group.event?.eventType || registration.eventType || 'Event / Activity'}
                                    />
                                    <DetailItem
                                      label="Event Date"
                                      value={formatEventDate(group.event?.date || registration.eventDate)}
                                    />
                                    <DetailItem label="Registrant" value={registration.name || 'Registrant'} />
                                    <DetailItem label="Email" value={registration.email || 'No email'} />
                                    <DetailItem label="Phone" value={registration.phone || 'No phone'} />
                                    {registration.combinedCount > 1 ? (
                                      <DetailItem
                                        label="Combined Records"
                                        value={`${registration.combinedCount} registration records for this profile/email`}
                                      />
                                    ) : null}
                                    <DetailItem label="Registered Date" value={formatDateTime(registration.registrationDate)} />
                                    <DetailItem label="Current Membership" value={user?.membershipStatus || 'Unknown'} />
                                    <DetailItem
                                      label="Membership When Registered"
                                      value={registration.membershipStatusAtRegistration || 'Unknown'}
                                    />
                                    <DetailItem label="Registration Status" value={registration.status || 'Registered'} />
                                    <DetailItem label="Amount Due" value={formatCurrencyValue(getAmountDue(registration))} />
                                    <DetailItem label="Amount Paid" value={formatCurrencyValue(registration.amountPaid || 0)} />
                                    <DetailItem label="Payment Status" value={formatPaymentSummary(registration)} />
                                    <DetailItem label="Payment Updated" value={formatDateTime(registration.paymentUpdatedDate)} />
                                    <DetailItem
                                      label="Profile"
                                      value={registration.userId ? 'Matched Profile' : 'Guest / Email Only'}
                                    />
                                    <DetailItem label="Payment Note" value={registration.paymentNote || 'None'} />
                                  </dl>
                                  {registration.combinedRecords?.length > 1 ? (
                                    <div className="registration-history-list">
                                      <strong>Registration History</strong>
                                      {registration.combinedRecords.map((record) => (
                                        <div className="registration-history-item" key={record.id}>
                                          <span>{formatDateTime(record.registrationDate)}</span>
                                          <span>{record.status || 'Registered'}</span>
                                          <span>{formatPaymentSummary(record)}</span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                      })}
                    </tbody>
                  </table>
                ) : (
                  <div className="empty-state compact-empty-state">
                    <h2>No registrations yet</h2>
                    <p>This event is listed, but no one has registered for it yet.</p>
                  </div>
                )}
              </div>
            </article>
          );
        }) : null}
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
                  <h2 id="registration-details-title">Edit Registration</h2>
                  <p className="section-helper">
                    Update the registration status or payment information.
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
            <div className="registration-edit-context">
              <strong>
                {selectedRegistration.name || 'Registrant'}
              </strong>
              <span>
                {getEventDisplayTitle(
                  selectedRegistrationEvent,
                  selectedRegistration.eventId,
                  selectedRegistration
                )}
              </span>
            </div>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="registration-edit-section">
              <h3>Registration Status</h3>
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
            </div>
            <div className="registration-edit-section">
              <h3>Payment</h3>
              <div className="registration-payment-grid">
                <label>
                  <span>Payment Status</span>
                  <select
                    disabled={paymentEditState.statusLocked}
                    value={selectedPaymentStatus}
                    onChange={(event) => handlePaymentStatusChange(event.target.value)}
                  >
                    {paymentStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Payment Method</span>
                  <select
                    disabled={paymentEditState.methodLocked}
                    value={selectedPaymentMethod}
                    onChange={(event) => setSelectedPaymentMethod(event.target.value)}
                  >
                    {paymentMethodOptions.map((method) => (
                      <option key={method} value={method}>
                        {method}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Amount Paid</span>
                  <input
                    min="0"
                    step="0.01"
                    type="number"
                    disabled={paymentEditState.amountLocked}
                    value={selectedPaymentAmount}
                    onChange={(event) => setSelectedPaymentAmount(event.target.value)}
                  />
                </label>
                <label className="registration-payment-note">
                  <span>Payment Note</span>
                  <textarea
                    rows="3"
                    value={selectedPaymentNote}
                    onChange={(event) => setSelectedPaymentNote(event.target.value)}
                    placeholder={selectedPaymentStatus === 'Refunded' ? 'Enter refund date, who approved it, and why.' : ''}
                  />
                </label>
                <p className="form-help registration-payment-help">
                  {getPaymentHelpText(selectedRegistration, selectedPaymentStatus)}
                </p>
              </div>
            </div>
            <div className="form-actions">
              <button
                className="button-link button-reset"
                disabled={
                  savingRegistrationId === selectedRegistration.id
                  || !hasRegistrationChanges(selectedRegistration, {
                    amountPaid: selectedPaymentAmount,
                    paymentMethod: selectedPaymentMethod,
                    paymentNote: selectedPaymentNote,
                    paymentStatus: selectedPaymentStatus,
                    status: selectedStatus
                  })
                }
                type="button"
                onClick={handleSaveChanges}
              >
                {savingRegistrationId === selectedRegistration.id ? 'Saving...' : 'Save Changes'}
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

function combineRegistrationsByRegistrant(registrations = []) {
  const groups = new Map();

  registrations.forEach((registration) => {
    const key = getRegistrantIdentityKey(registration);
    const existing = groups.get(key) || [];
    existing.push(registration);
    groups.set(key, existing);
  });

  return [...groups.values()].map((records) => {
    const preferred = [...records].sort(compareRegistrationPriority)[0] || records[0];

    return {
      ...preferred,
      combinedCount: records.length,
      combinedRecords: records
    };
  });
}

function getRegistrantIdentityKey(registration) {
  return registration.userId
    ? `user:${registration.userId}`
    : `email:${normalizeEmail(registration.email || registration.name || registration.id)}`;
}

function compareRegistrationPriority(first, second) {
  const firstRank = getRegistrationStatusRank(first.status);
  const secondRank = getRegistrationStatusRank(second.status);

  if (firstRank !== secondRank) {
    return firstRank - secondRank;
  }

  return getTimestampValue(second.registrationDate) - getTimestampValue(first.registrationDate);
}

function getRegistrationStatusRank(status) {
  if (status === 'Registered') {
    return 1;
  }

  if (status === 'Waitlisted') {
    return 2;
  }

  if (status === 'Cancelled') {
    return 3;
  }

  return 4;
}

function sortRegistrationsForDisplay(registrations, sortConfig, userMap) {
  return [...registrations].sort((first, second) => {
    const firstValue = getRegistrationSortValue(first, sortConfig.key, userMap);
    const secondValue = getRegistrationSortValue(second, sortConfig.key, userMap);
    const comparison = typeof firstValue === 'number' || typeof secondValue === 'number'
      ? Number(firstValue || 0) - Number(secondValue || 0)
      : String(firstValue || '').localeCompare(String(secondValue || ''), undefined, {
        numeric: true,
        sensitivity: 'base'
      });

    return sortConfig.direction === 'asc' ? comparison : -comparison;
  });
}

function getRegistrationSortValue(registration, sortKey, userMap) {
  const user =
    userMap.byId.get(registration.userId)
    || userMap.byEmail.get(normalizeEmail(registration.email));

  if (sortKey === 'registeredDate') {
    return getTimestampValue(registration.registrationDate);
  }

  if (sortKey === 'membership') {
    return user?.membershipStatus || registration.membershipStatusAtRegistration || 'Unknown';
  }

  if (sortKey === 'status') {
    return registration.status || 'Registered';
  }

  if (sortKey === 'payment') {
    return formatPaymentSummary(registration);
  }

  if (sortKey === 'profile') {
    return registration.userId ? 'Matched Profile' : 'Guest / Email Only';
  }

  return registration.name || registration.email || '';
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

function formatCurrencyValue(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString(undefined, {
    currency: 'USD',
    style: 'currency'
  });
}

function formatPaymentSummary(registration) {
  const status = registration.paymentStatus || 'Pending';
  const method = registration.paymentMethod || 'None';

  return method === 'None' ? status : `${status} (${method})`;
}

function getAmountDue(registration) {
  if (registration.amountDue !== undefined) {
    return registration.amountDue;
  }

  return Number(registration.eventCost || 0) + Number(registration.eventServiceFee || 0);
}

function isOnlinePayment(registration) {
  return registration?.paymentStatus === 'Paid' && registration?.paymentMethod === 'Online';
}

function getPaymentStatusOptions(registration) {
  if (isOnlinePayment(registration)) {
    return ['Paid', 'Refunded'];
  }

  const options = ['Pending', 'Paid', 'Refunded', 'Waived'];

  if (registration?.paymentStatus === 'Failed') {
    return ['Failed', ...options];
  }

  return options;
}

function getPaymentMethodOptions(registration, paymentStatus) {
  if (isOnlinePayment(registration)) {
    return ['Online'];
  }

  if (paymentStatus === 'Paid') {
    return MANUAL_PAYMENT_METHOD_OPTIONS;
  }

  if (paymentStatus === 'Waived') {
    return ['Comped'];
  }

  if (paymentStatus === 'Refunded') {
    return [registration?.paymentMethod || 'None'];
  }

  return ['None'];
}

function getPaymentEditState(registration, paymentStatus) {
  const onlinePayment = isOnlinePayment(registration);

  return {
    amountLocked: onlinePayment || paymentStatus !== 'Paid',
    methodLocked: onlinePayment || paymentStatus !== 'Paid',
    statusLocked: false
  };
}

function normalizePaymentEdit(registration, paymentEdit) {
  const paymentStatus = paymentEdit.paymentStatus || 'Pending';
  const paymentNote = paymentEdit.paymentNote.trim();

  if (isOnlinePayment(registration)) {
    if (paymentStatus === 'Paid') {
      return {
        payment: {
          amountPaid: Number(registration.amountPaid || 0),
          paymentMethod: 'Online',
          paymentNote,
          paymentStatus: 'Paid'
        }
      };
    }

    if (paymentStatus !== 'Refunded') {
      return { error: 'Online Square payments can only be marked refunded.' };
    }

    if (!paymentNote) {
      return { error: 'Enter refund details: when, who approved it, and why.' };
    }

    return {
      payment: {
        amountPaid: Number(registration.amountPaid || 0),
        paymentMethod: 'Online',
        paymentNote,
        paymentStatus: 'Refunded'
      }
    };
  }

  if (paymentStatus === 'Pending') {
    return {
      payment: {
        amountPaid: 0,
        paymentMethod: 'None',
        paymentNote,
        paymentStatus: 'Pending'
      }
    };
  }

  if (paymentStatus === 'Waived') {
    return {
      payment: {
        amountPaid: 0,
        paymentMethod: 'Comped',
        paymentNote,
        paymentStatus: 'Waived'
      }
    };
  }

  if (paymentStatus === 'Refunded') {
    if (!paymentNote) {
      return { error: 'Enter refund details: when, who approved it, and why.' };
    }

    return {
      payment: {
        amountPaid: Number(registration.amountPaid || 0),
        paymentMethod: registration.paymentMethod || 'None',
        paymentNote,
        paymentStatus: 'Refunded'
      }
    };
  }

  if (paymentStatus === 'Paid') {
    const paymentMethod = MANUAL_PAYMENT_METHOD_OPTIONS.includes(paymentEdit.paymentMethod)
      ? paymentEdit.paymentMethod
      : 'Cash';
    const amountPaid = Number(paymentEdit.amountPaid || 0);

    if (amountPaid <= 0) {
      return { error: 'Enter the amount received for a cash or check payment.' };
    }

    return {
      payment: {
        amountPaid,
        paymentMethod,
        paymentNote,
        paymentStatus: 'Paid'
      }
    };
  }

  return {
    payment: {
      amountPaid: Number(paymentEdit.amountPaid || 0),
      paymentMethod: paymentEdit.paymentMethod || 'None',
      paymentNote,
      paymentStatus
    }
  };
}

function getPaymentHelpText(registration, paymentStatus) {
  if (isOnlinePayment(registration)) {
    return 'Online Square payments are locked. Use Refunded only after the refund is handled in Square.';
  }

  if (paymentStatus === 'Pending') {
    return 'Method and amount stay locked until payment is marked paid.';
  }

  if (paymentStatus === 'Paid') {
    return 'For cash or check payments, choose the method and enter the amount received.';
  }

  if (paymentStatus === 'Waived') {
    return 'Waived payments are recorded as Comped with $0.00 paid.';
  }

  if (paymentStatus === 'Refunded') {
    return 'Enter refund details: when, who approved it, and why.';
  }

  return 'Failed payments usually come from an online processor and should be reviewed before changing.';
}

function getActivityFilterValue(eventType = '') {
  if (['Class (Half Day)', 'Class (Full Day)', 'Class (Half-Day)', 'Class (Full-Day)', 'Lecture'].includes(eventType)) {
    return 'Programs';
  }

  if (eventType === 'Workshop') {
    return 'Workshops';
  }

  if (eventType === 'Retreat') {
    return 'Retreat';
  }

  if (eventType === 'Challenges' || eventType === 'Challenge') {
    return 'Challenges';
  }

  return '';
}

function getQuarterFilterValue(dateValue) {
  if (!dateValue) {
    return '';
  }

  const date = typeof dateValue.toDate === 'function'
    ? dateValue.toDate()
    : new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return `Q${Math.floor(date.getMonth() / 3) + 1}`;
}

function getYearFilterValue(dateValue) {
  if (!dateValue) {
    return '';
  }

  const date = typeof dateValue.toDate === 'function'
    ? dateValue.toDate()
    : new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return String(date.getFullYear());
}

function hasPaymentChanged(registration, paymentEdit) {
  return Number(paymentEdit.amountPaid || 0) !== Number(registration.amountPaid || 0)
    || paymentEdit.paymentMethod !== (registration.paymentMethod || 'None')
    || paymentEdit.paymentNote.trim() !== (registration.paymentNote || '')
    || paymentEdit.paymentStatus !== (registration.paymentStatus || 'Pending');
}

function hasRegistrationChanges(registration, edit) {
  return edit.status !== (registration.status || 'Registered')
    || hasPaymentChanged(registration, edit);
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

function getCapacitySummaryCount(event, registeredCount) {
  if (!event) {
    return 0;
  }

  if (event.capacityUnlimited) {
    return registeredCount;
  }

  return Number(event.capacity || 0);
}

function getStatPillClass(count) {
  return Number(count || 0) > 0 ? 'has-count' : 'no-count';
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export default RegistrationPanel;
