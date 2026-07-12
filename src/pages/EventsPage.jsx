import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { subscribeToPublishedEvents } from '../services/eventService.js';
import {
  formatCurrency,
  formatEventDate,
  formatTimeRange,
  isEventVisible
} from '../utils/eventFormat.js';

function EventsPage() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = subscribeToPublishedEvents(
      (snapshot) => {
        setEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
        setError('');
        setLoading(false);
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, []);

  const visibleEvents = useMemo(() => events.filter(isEventVisible), [events]);

  return (
    <section>
      <PageHeader
        eyebrow="Events"
        title="Upcoming programs"
        description="Browse upcoming classes, workshops, retreats, lectures, challenges, business listings, and sale listings."
      />
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? (
        <div className="empty-state">
          <h2>Loading events</h2>
          <p>Retrieving published events.</p>
        </div>
      ) : null}
      {!loading && !visibleEvents.length ? (
        <div className="empty-state">
          <h2>No published events yet</h2>
          <p>Published events will be listed here when they are ready.</p>
        </div>
      ) : null}
      <div className="public-event-list">
        {visibleEvents.map((event) => (
          <article className="public-event-card" key={event.id}>
            <div className="public-event-card-main">
              <div className="card-kicker">
                <span>{event.eventType}</span>
                <strong>
                  {event.registrationOpen ? 'Registration open' : 'Registration closed'}
                </strong>
              </div>
              <h2>{event.title}</h2>
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
                  <dd>{event.isPaid ? formatCurrency(event.cost) : 'Free'}</dd>
                </div>
              </dl>
            </div>
            <div className="public-event-card-actions">
              {event.supplyListUrl ? (
                <a className="text-button" href={event.supplyListUrl}>
                  {event.supplyListTitle || event.supplyListFileName || 'Supply list'}
                </a>
              ) : null}
              <Link className="button-link secondary-action" to={`/events/${event.id}`}>
                View Details
              </Link>
              {event.registrationOpen ? (
                <Link className="button-link" to={`/events/${event.id}`}>
                  Register
                </Link>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default EventsPage;
