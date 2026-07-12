import { useMemo, useState } from 'react';
import { EVENT_TYPES } from '../../data/eventOptions.js';
import { formatCurrency, formatEventDate, formatTimeRange } from '../../utils/eventFormat.js';

const ALL_TYPES = 'All';
const FILTER_TYPES = ['All', ...EVENT_TYPES];

function EventList({ events, loading, onDelete, onEdit }) {
  const [eventTypeFilter, setEventTypeFilter] = useState(ALL_TYPES);

  const eventTypeCounts = useMemo(
    () =>
      events.reduce((counts, event) => {
        const type = event.eventType || 'Other';
        return type in counts ? { ...counts, [type]: counts[type] + 1 } : counts;
      }, Object.fromEntries(FILTER_TYPES.slice(1).map((type) => [type, 0]))),
    [events]
  );
  const eventTypeFilters = useMemo(
    () => FILTER_TYPES,
    []
  );
  const filteredEvents = useMemo(
    () =>
      eventTypeFilter === ALL_TYPES
        ? events
        : events.filter((event) => (event.eventType || 'Other') === eventTypeFilter),
    [eventTypeFilter, events]
  );

  if (loading) {
    return (
      <div className="empty-state">
        <h2>Loading events</h2>
        <p>Retrieving event records from Firestore.</p>
      </div>
    );
  }

  if (!events.length) {
    return (
      <div className="empty-state">
        <h2>No events yet</h2>
        <p>Create the first class, workshop, lecture, retreat, or listing.</p>
      </div>
    );
  }

  return (
    <div className="event-admin-list">
      <div className="status-filter-group separated-filter-row" aria-label="Event type filters">
        {eventTypeFilters.map((type) => (
          <button
            className={`status-filter-button${eventTypeFilter === type ? ' active' : ''}`}
            key={type}
            type="button"
            onClick={() => setEventTypeFilter(type)}
          >
            {type === ALL_TYPES ? `All (${events.length})` : `${type} (${eventTypeCounts[type] || 0})`}
          </button>
        ))}
      </div>
      {!filteredEvents.length ? (
        <div className="empty-state compact-empty-state">
          <h2>No matching events</h2>
          <p>Try a different event type filter.</p>
        </div>
      ) : null}
      {filteredEvents.map((event) => (
        <article className="event-admin-card" key={event.id}>
          <div>
            <div className="card-kicker">
              <span>{event.eventType || 'Type TBD'}</span>
              <strong>{event.status}</strong>
            </div>
            <h3>{event.title || 'Untitled Draft'}</h3>
            <p>{event.description || 'Description TBD'}</p>
            <dl>
              <div>
                <dt>Date</dt>
                <dd>{formatEventDate(event.date)}</dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{event.location || 'Location TBD'}</dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>
                  {event.isPaid ? formatCurrency(event.cost) : 'Free'} plus{' '}
                  {formatCurrency(event.serviceFee)} fee
                </dd>
              </div>
            </dl>
          </div>
          <div className="card-actions">
            <button className="button-link button-reset" type="button" onClick={() => onEdit(event)}>
              Edit
            </button>
            <button className="danger-button" type="button" onClick={() => onDelete(event)}>
              Delete
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export default EventList;
