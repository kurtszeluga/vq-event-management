import { useEffect, useMemo, useState } from 'react';
import { subscribeToSquareWebhookEvents } from '../../services/registrationService.js';

const FILTERS = [
  { label: 'Needs Review', value: 'needs-review' },
  { label: 'All', value: 'all' },
  { label: 'Completed', value: 'completed' },
  { label: 'No Action', value: 'no-action' }
];

function PaymentReconciliationPanel() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('needs-review');
  const [loading, setLoading] = useState(true);

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

  const counts = useMemo(
    () => ({
      all: events.length,
      completed: events.filter(isCompletedEvent).length,
      needsReview: events.filter(isNeedsReviewEvent).length,
      noAction: events.filter(isNoActionEvent).length
    }),
    [events]
  );
  const filteredEvents = useMemo(
    () => events.filter((event) => matchesFilter(event, filter)),
    [events, filter]
  );

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
                <th scope="col">Event</th>
                <th scope="col">Reconciliation</th>
                <th scope="col">Object</th>
                <th scope="col">Review Details</th>
              </tr>
            </thead>
            <tbody>
              {filteredEvents.map((event) => (
                <tr className={isNeedsReviewEvent(event) ? 'payment-review-needs-attention' : ''} key={event.id}>
                  <td data-label="Received">{formatDateTime(event.receivedAt)}</td>
                  <td data-label="Event">
                    <strong>{event.eventType || 'Unknown'}</strong>
                    <span className="table-subtext">{event.eventId || event.id}</span>
                  </td>
                  <td data-label="Reconciliation">
                    <span className={getStatusPillClass(event)}>{event.reconciliationStatus || 'No Action'}</span>
                  </td>
                  <td data-label="Object">
                    <strong>{event.objectType || 'Square Object'}</strong>
                    <span className="table-subtext">{event.objectId || 'No object id'}</span>
                  </td>
                  <td data-label="Review Details">{formatReviewDetails(event.reviewDetails)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
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

  if (filter === 'no-action') {
    return counts.noAction;
  }

  return counts.needsReview;
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

function getStatusPillClass(event) {
  if (isNeedsReviewEvent(event)) {
    return 'status-pill warning';
  }

  if (isCompletedEvent(event)) {
    return 'status-pill good';
  }

  return 'status-pill neutral';
}

function formatReviewDetails(details = {}) {
  const entries = Object.entries(details || {}).filter(([, value]) => value !== '' && value != null);

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
