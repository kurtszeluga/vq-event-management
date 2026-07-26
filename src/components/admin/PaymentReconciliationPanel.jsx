import { useEffect, useMemo, useState } from 'react';
import {
  resolvePaymentReviewItem,
  subscribeToRegistrations,
  subscribeToSquareWebhookEvents,
  updateRegistrationPayment
} from '../../services/registrationService.js';
import { formatCurrency } from '../../utils/eventFormat.js';

const FILTERS = [
  { label: 'Needs Review', value: 'needs-review' },
  { label: 'All', value: 'all' },
  { label: 'Completed', value: 'completed' },
  { label: 'Reviewed', value: 'reviewed' },
  { label: 'No Action', value: 'no-action' }
];

function PaymentReconciliationPanel() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('needs-review');
  const [loading, setLoading] = useState(true);
  const [resolutionNotes, setResolutionNotes] = useState({});
  const [resolvingId, setResolvingId] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [registrations, setRegistrations] = useState([]);
  const [loadingCashCheck, setLoadingCashCheck] = useState(true);
  const [cashCheckMethods, setCashCheckMethods] = useState({});
  const [collectingRegistrationId, setCollectingRegistrationId] = useState('');
  const [cashCheckError, setCashCheckError] = useState('');
  const [cashCheckSuccess, setCashCheckSuccess] = useState('');

  useEffect(() => {
    const unsubscribe = subscribeToSquareWebhookEvents(
      (snapshot) => {
        setEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
        setError('');
        setLoading(false);
      },
      (snapshotError) => {
        setEvents([]);
        setError(snapshotError.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = subscribeToRegistrations(
      (snapshot) => {
        setRegistrations(snapshot.docs.map((registrationDoc) => ({
          id: registrationDoc.id,
          ...registrationDoc.data()
        })));
        setLoadingCashCheck(false);
      },
      () => setLoadingCashCheck(false)
    );

    return unsubscribe;
  }, []);

  const pendingCashCheckRegistrations = useMemo(
    () => registrations
      .filter(isCashCheckAwaitingCollection)
      .sort((first, second) => getTimestampValue(second.registrationDate) - getTimestampValue(first.registrationDate)),
    [registrations]
  );

  const handleMarkCashCheckPaid = async (registration) => {
    const method = cashCheckMethods[registration.id];

    if (!['Cash', 'Check'].includes(method)) {
      setCashCheckError('Choose Cash or Check before marking a payment received.');
      setCashCheckSuccess('');
      return;
    }

    setCashCheckError('');
    setCashCheckSuccess('');
    setCollectingRegistrationId(registration.id);

    try {
      await updateRegistrationPayment(registration.id, {
        amountPaid: registration.amountDue,
        paymentMethod: method,
        paymentNote: 'Cash/check payment collected via Payment Review.',
        paymentStatus: 'Paid'
      });
      setCashCheckSuccess(`Marked ${registration.name || registration.email || 'this registration'} paid.`);
    } catch (collectError) {
      setCashCheckError(collectError.message || 'Payment could not be marked received.');
    } finally {
      setCollectingRegistrationId('');
    }
  };

  const counts = useMemo(
    () => ({
      all: events.length,
      completed: events.filter(isCompletedEvent).length,
      needsReview: events.filter(isNeedsReviewEvent).length,
      noAction: events.filter(isNoActionEvent).length,
      reviewed: events.filter(isReviewedEvent).length
    }),
    [events]
  );
  const filteredEvents = useMemo(
    () => events.filter((event) => matchesFilter(event, filter)),
    [events, filter]
  );
  const handleNoteChange = (eventId, value) => {
    setResolutionNotes((currentNotes) => ({ ...currentNotes, [eventId]: value }));
  };
  const handleResolveReview = async (event) => {
    const resolutionNote = String(resolutionNotes[event.id] || '').trim();

    if (!resolutionNote) {
      setError('Enter a short note before marking the payment review item as reviewed.');
      setSuccessMessage('');
      return;
    }

    setError('');
    setSuccessMessage('');
    setResolvingId(event.id);

    try {
      await resolvePaymentReviewItem(event.id, resolutionNote);
      setResolutionNotes((currentNotes) => {
        const nextNotes = { ...currentNotes };
        delete nextNotes[event.id];
        return nextNotes;
      });
      setSuccessMessage('Payment review item marked reviewed.');
    } catch (resolveError) {
      setError(resolveError.message || 'Payment review item could not be marked reviewed.');
    } finally {
      setResolvingId('');
    }
  };

  return (
    <section className="admin-list-panel" id="payment-review-card">
      <div className="form-section-header form-section-header-stacked">
        <div className="form-section-header-top">
          <h2>Payment Review</h2>
        </div>
        <p className="form-help">
          Review Square webhook events that could not be matched automatically or need payment follow-up.
        </p>
      </div>
      <div className="form-subsection">
        <h3>Cash/Check Awaiting Collection</h3>
        <p className="form-help">
          Registrations - self-service or admin-registered - where the member chose to pay by
          cash or check and it has not been marked received yet.
        </p>
        {cashCheckError ? <p className="form-error">{cashCheckError}</p> : null}
        {cashCheckSuccess ? <p className="form-success">{cashCheckSuccess}</p> : null}
        {loadingCashCheck ? (
          <div className="empty-state compact-empty-state">
            <h2>Loading registrations</h2>
            <p>Checking for cash/check payments awaiting collection.</p>
          </div>
        ) : !pendingCashCheckRegistrations.length ? (
          <div className="empty-state compact-empty-state">
            <h2>Nothing awaiting collection</h2>
            <p>Every cash/check registration has been marked paid.</p>
          </div>
        ) : (
          <div className="table-scroll">
            <table className="user-table payment-review-table">
              <thead>
                <tr>
                  <th scope="col">Registered</th>
                  <th scope="col">Registrant / Event</th>
                  <th scope="col">Amount Due</th>
                  <th scope="col">Mark Received</th>
                </tr>
              </thead>
              <tbody>
                {pendingCashCheckRegistrations.map((registration) => (
                  <tr key={registration.id}>
                    <td data-label="Registered">{formatDateTime(registration.registrationDate)}</td>
                    <td data-label="Registrant / Event">
                      <strong>{registration.name || registration.email || 'Registrant'}</strong>
                      <span className="table-subtext">{registration.eventTitle || 'Event not matched'}</span>
                    </td>
                    <td data-label="Amount Due">{formatCurrency(registration.amountDue || 0)}</td>
                    <td data-label="Mark Received">
                      <div className="payment-review-actions">
                        <div className="radio-options">
                          <label className="checkbox-label">
                            <input
                              checked={cashCheckMethods[registration.id] === 'Cash'}
                              disabled={collectingRegistrationId === registration.id}
                              name={`cash-check-method-${registration.id}`}
                              type="radio"
                              onChange={() => setCashCheckMethods((current) => ({
                                ...current,
                                [registration.id]: 'Cash'
                              }))}
                            />
                            <span>Cash</span>
                          </label>
                          <label className="checkbox-label">
                            <input
                              checked={cashCheckMethods[registration.id] === 'Check'}
                              disabled={collectingRegistrationId === registration.id}
                              name={`cash-check-method-${registration.id}`}
                              type="radio"
                              onChange={() => setCashCheckMethods((current) => ({
                                ...current,
                                [registration.id]: 'Check'
                              }))}
                            />
                            <span>Check</span>
                          </label>
                        </div>
                        <button
                          className="button-link"
                          disabled={collectingRegistrationId === registration.id}
                          type="button"
                          onClick={() => handleMarkCashCheckPaid(registration)}
                        >
                          {collectingRegistrationId === registration.id ? 'Saving...' : 'Mark Paid'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div className="form-subsection">
        <h3>Square Webhook Reconciliation</h3>
        <div className="status-filter-group separated-filter-row" aria-label="Payment review filters">
          {FILTERS.map((item) => (
            <button
              className={`status-filter-button${filter === item.value ? ' active' : ''}${item.value === 'needs-review' && filter === item.value ? ' archive-active' : ''}`}
              key={item.value}
              type="button"
              onClick={() => setFilter(item.value)}
            >
              {item.label} ({getFilterCount(item.value, counts)})
            </button>
          ))}
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {successMessage ? <p className="form-success">{successMessage}</p> : null}
        {loading ? (
          <div className="empty-state compact-empty-state">
            <h2>Loading payment events</h2>
            <p>Checking Square webhook reconciliation records.</p>
          </div>
        ) : null}
        {!loading && !filteredEvents.length ? (
          <div className="empty-state compact-empty-state">
            <h2>No payment review items</h2>
            <p>No Square webhook records match this filter.</p>
          </div>
        ) : null}
        {filteredEvents.length ? (
          <div className="table-scroll">
            <table className="user-table payment-review-table">
              <thead>
                <tr>
                  <th scope="col">Received</th>
                  <th scope="col">Registrant / Event</th>
                  <th scope="col">Reconciliation</th>
                  <th scope="col">Review Details</th>
                  <th scope="col">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event) => (
                  <tr className={isNeedsReviewEvent(event) ? 'payment-review-needs-attention' : ''} key={event.id}>
                    <td data-label="Received">{formatDateTime(event.receivedAt)}</td>
                    <td data-label="Registrant / Event">
                      <strong>{event.registrationName || event.registrationEmail || 'Registrant not matched'}</strong>
                      <span className="table-subtext">{event.eventTitle || 'Event not matched'}</span>
                      {event.registrationId ? <span className="table-subtext">Registration: {event.registrationId}</span> : null}
                    </td>
                    <td data-label="Reconciliation">
                      <span className={getStatusPillClass(event)}>{event.reconciliationStatus || 'No Action'}</span>
                    </td>
                    <td data-label="Review Details">{formatReviewDetails(event)}</td>
                    <td data-label="Action">
                      {isNeedsReviewEvent(event) ? (
                        <div className="payment-review-actions">
                          <label htmlFor={`payment-review-note-${event.id}`}>Resolution note</label>
                          <textarea
                            id={`payment-review-note-${event.id}`}
                            value={resolutionNotes[event.id] || ''}
                            onChange={(changeEvent) => handleNoteChange(event.id, changeEvent.target.value)}
                            placeholder="Example: matched manually to registration, no further action needed."
                          />
                          <button
                            className="button-link"
                            disabled={resolvingId === event.id}
                            type="button"
                            onClick={() => handleResolveReview(event)}
                          >
                            {resolvingId === event.id ? 'Saving...' : 'Mark Reviewed'}
                          </button>
                        </div>
                      ) : isReviewedEvent(event) ? (
                        <div className="payment-review-reviewed">
                          <strong>Reviewed</strong>
                          <span>{formatResolvedBy(event)}</span>
                          {event.resolutionNote ? <span>{event.resolutionNote}</span> : null}
                        </div>
                      ) : (
                        <span className="table-subtext">No action needed</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function matchesFilter(event, filter) {
  if (filter === 'all') {
    return true;
  }

  if (filter === 'completed') {
    return isCompletedEvent(event);
  }

  if (filter === 'reviewed') {
    return isReviewedEvent(event);
  }

  if (filter === 'no-action') {
    return isNoActionEvent(event);
  }

  return isNeedsReviewEvent(event);
}

function getFilterCount(filter, counts) {
  if (filter === 'all') {
    return counts.all;
  }

  if (filter === 'completed') {
    return counts.completed;
  }

  if (filter === 'reviewed') {
    return counts.reviewed;
  }

  if (filter === 'no-action') {
    return counts.noAction;
  }

  return counts.needsReview;
}

// A registration only needs collecting once it actually holds a seat - a
// Waitlisted cash/check preference has nothing to collect payment for yet -
// and only while it is still genuinely unpaid, matching the same fields
// create-registration.js sets at creation (or resolveAdminCollectedPayment
// already marked it Paid there instead of reaching this list at all).
function isCashCheckAwaitingCollection(registration = {}) {
  return registration.status === 'Registered'
    && registration.paymentStatus === 'Pending'
    && registration.paymentPreference === 'cash-check-later';
}

function getTimestampValue(value) {
  return toDate(value)?.getTime() || 0;
}

function isCompletedEvent(event) {
  return ['Payment Completed', 'Refund Completed'].includes(event.reconciliationStatus);
}

function isNoActionEvent(event) {
  return !event.reconciliationStatus || event.reconciliationStatus === 'No Action';
}

function isNeedsReviewEvent(event) {
  return String(event.reconciliationStatus || '').includes('Needs Review');
}

function isReviewedEvent(event) {
  return event.reconciliationStatus === 'Reviewed';
}

function getStatusPillClass(event) {
  if (isNeedsReviewEvent(event)) {
    return 'status-pill warning';
  }

  if (isCompletedEvent(event)) {
    return 'status-pill good';
  }

  if (isReviewedEvent(event)) {
    return 'status-pill neutral';
  }

  return 'status-pill neutral';
}

function formatReviewDetails(event = {}) {
  const details = {
    ...(event.reviewDetails || {}),
    squareObjectId: event.objectId || '',
    squareObjectType: event.objectType || '',
    webhookType: event.eventType || ''
  };
  const entries = Object.entries(details).filter(([, value]) => value !== '' && value != null);

  if (!entries.length) {
    return 'None';
  }

  return entries.map(([key, value]) => `${formatKey(key)}: ${String(value)}`).join('; ');
}

function formatKey(value) {
  return String(value)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function formatDateTime(value) {
  const date = toDate(value);

  return date ? date.toLocaleString() : 'Not recorded';
}

function formatResolvedBy(event) {
  const reviewer = event.resolvedByName || event.resolvedByEmail || 'Admin';
  const reviewedAt = formatDateTime(event.resolvedAt);

  return `${reviewer} on ${reviewedAt}`;
}

function toDate(value) {
  if (!value) {
    return null;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default PaymentReconciliationPanel;
