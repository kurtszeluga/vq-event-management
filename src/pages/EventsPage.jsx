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

const DESCRIPTION_PREVIEW_LENGTH = 180;
const ALL_EVENT_TYPES = 'All';

function getEventTypeLabel(event) {
  return event.eventType || 'Other';
}

function getEventThumbnail(event) {
  return event.imageUrls?.find(Boolean) || '';
}

function getDescriptionPreview(description) {
  if (!description || description.length <= DESCRIPTION_PREVIEW_LENGTH) {
    return description;
  }

  return `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trim()}...`;
}

function EventsPage() {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState(ALL_EVENT_TYPES);
  const [expandedDescriptions, setExpandedDescriptions] = useState({});
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
  const eventTypeCounts = useMemo(
    () =>
      visibleEvents.reduce((counts, event) => {
        const type = getEventTypeLabel(event);
        return { ...counts, [type]: (counts[type] || 0) + 1 };
      }, {}),
    [visibleEvents]
  );
  const eventTypeFilters = useMemo(
    () => [ALL_EVENT_TYPES, ...Object.keys(eventTypeCounts).sort()],
    [eventTypeCounts]
  );
  const filteredEvents = useMemo(
    () =>
      eventTypeFilter === ALL_EVENT_TYPES
        ? visibleEvents
        : visibleEvents.filter((event) => getEventTypeLabel(event) === eventTypeFilter),
    [eventTypeFilter, visibleEvents]
  );

  useEffect(() => {
    if (eventTypeFilter !== ALL_EVENT_TYPES && !eventTypeFilters.includes(eventTypeFilter)) {
      setEventTypeFilter(ALL_EVENT_TYPES);
    }
  }, [eventTypeFilter, eventTypeFilters]);

  function toggleDescription(eventId) {
    setExpandedDescriptions((current) => ({
      ...current,
      [eventId]: !current[eventId]
    }));
  }

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
      {!loading && visibleEvents.length ? (
        <div className="status-filter-group event-type-filter" aria-label="Event type filters">
          {eventTypeFilters.map((type) => (
            <button
              className={`status-filter-button${eventTypeFilter === type ? ' active' : ''}`}
              key={type}
              onClick={() => setEventTypeFilter(type)}
              type="button"
            >
              {type === ALL_EVENT_TYPES
                ? `All (${visibleEvents.length})`
                : `${type} (${eventTypeCounts[type] || 0})`}
            </button>
          ))}
        </div>
      ) : null}
      <div className="public-event-list">
        {filteredEvents.map((event) => {
          const description = event.description || '';
          const descriptionIsLong = description.length > DESCRIPTION_PREVIEW_LENGTH;
          const descriptionExpanded = Boolean(expandedDescriptions[event.id]);
          const thumbnailUrl = getEventThumbnail(event);

          return (
            <article className="public-event-card" key={event.id}>
              <div className="public-event-card-main">
                <div className="card-kicker">
                  <span>{getEventTypeLabel(event)}</span>
                  <strong>
                    {event.registrationOpen ? 'Registration open' : 'Registration closed'}
                  </strong>
                </div>
                <h2>{event.title}</h2>
                {description ? (
                  <div className="event-card-description">
                    <p>{descriptionExpanded ? description : getDescriptionPreview(description)}</p>
                    {descriptionIsLong ? (
                      <button
                        className="text-button event-description-toggle"
                        onClick={() => toggleDescription(event.id)}
                        type="button"
                      >
                        {descriptionExpanded ? 'Hide Description' : 'Show Full Description'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <dl>
                  <div className="event-card-date">
                    <dt>Date</dt>
                    <dd>{formatEventDate(event.date)}</dd>
                  </div>
                  <div>
                    <dt>Time</dt>
                    <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
                  </div>
                  <div>
                    <dt>Presenter</dt>
                    <dd>{event.presenter || 'To be announced'}</dd>
                  </div>
                  <div>
                    <dt>Cost</dt>
                    <dd>{event.isPaid ? formatCurrency(event.cost) : 'Free'}</dd>
                  </div>
                </dl>
              </div>
              <div className="public-event-card-thumbnail">
                {thumbnailUrl ? (
                  <img alt={`${event.title} thumbnail`} src={thumbnailUrl} />
                ) : (
                  <div className="image-placeholder" aria-label="No image uploaded" />
                )}
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
          );
        })}
      </div>
    </section>
  );
}

export default EventsPage;
