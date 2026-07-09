import { formatCurrency, formatEventDate, formatTimeRange } from '../../utils/eventFormat.js';

function EventList({ events, loading, onDelete, onEdit }) {
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
      {events.map((event) => (
        <article className="event-admin-card" key={event.id}>
          <div>
            <div className="card-kicker">
              <span>{event.eventType}</span>
              <strong>{event.status}</strong>
            </div>
            <h3>{event.title}</h3>
            <p>{event.description}</p>
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
                <dd>{event.location}</dd>
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
