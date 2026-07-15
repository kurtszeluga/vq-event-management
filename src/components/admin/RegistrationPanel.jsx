import { useEffect, useMemo, useState } from 'react';
import {
  subscribeToAdminEvents,
  subscribeToPublishedEvents
} from '../../services/eventService.js';
import {
  subscribeToRegistrations,
  updateRegistrationPayment,
  updateRegistrationStatus
} from '../../services/registrationService.js';
import { subscribeToUsers } from '../../services/userService.js';
import { formatEventDate } from '../../utils/eventFormat.js';

const REGISTRATION_STATUS_FILTERS = ['All', 'Registered', 'Waitlisted', 'Cancelled'];
const PAYMENT_STATUS_FILTERS = ['All', 'Pending', 'Paid', 'Refunded', 'Failed', 'Waived'];
const MANUAL_PAYMENT_METHOD_OPTIONS = ['Cash', 'Check'];

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
  const [selectedPaymentAmount, setSelectedPaymentAmount] = useState('');
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('None');
  const [selectedPaymentNote, setSelectedPaymentNote] = useState('');
  const [selectedPaymentStatus, setSelectedPaymentStatus] = useState('Pending');
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
        } else if (registration.paymentStatus === 'Failed') {
          counts.failed += 1;
        } else if (registration.paymentStatus === 'Waived') {
          counts.waived += 1;
        } else {
          counts.pending += 1;
        }

        return counts;
      },
      {
        cancelled: 0,
        failed: 0,
        paid: 0,
        pending: 0,
        refunded: 0,
        registered: 0,
        total: 0,
        waived: 0,
        waitlisted: 0
      }
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
          registration.paymentMethod,
          registration.paymentNote,
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
  const paymentEditState = getPaymentEditState(selectedRegistration, selectedPaymentStatus);
  const paymentMethodOptions = getPaymentMethodOptions(selectedRegistration, selectedPaymentStatus);
  const paymentStatusOptions = getPaymentStatusOptions(selectedRegistration);

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
      if (statusChanged) {
        await updateRegistrationStatus(selectedRegistration.id, selectedStatus, currentUserProfile);
      }

      if (paymentChanged) {
        await updateRegistrationPayment(selectedRegistration.id, nextPayment.payment, currentUserProfile);
      }

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
        <span>Waived: {registrationSummary.waived}</span>
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
                          <td data-label="Payment">{formatPaymentSummary(registration)}</td>
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
              <DetailItem label="Amount Due" value={formatCurrencyValue(getAmountDue(selectedRegistration))} />
              <DetailItem label="Amount Paid" value={formatCurrencyValue(selectedRegistration.amountPaid || 0)} />
              <DetailItem label="Payment Status" value={formatPaymentSummary(selectedRegistration)} />
              <DetailItem label="Payment Updated" value={formatDateTime(selectedRegistration.paymentUpdatedDate)} />
              <DetailItem
                label="Profile"
                value={selectedRegistration.userId ? 'Matched Profile' : 'Guest / Email Only'}
              />
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

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export default RegistrationPanel;
