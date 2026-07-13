import { useEffect, useMemo, useState } from 'react';
import { EVENT_TYPES } from '../../data/eventOptions.js';
import { formatCurrency, formatEventDate, formatTimeRange } from '../../utils/eventFormat.js';

const ALL_TYPES = 'All';
const DESCRIPTION_PREVIEW_LENGTH = 180;
const FILTER_TYPES = ['All', ...EVENT_TYPES];

function EventList({
  events,
  isSuperUser,
  loading,
  onDelete,
  onEdit,
  defaultEventTypeFilter = ALL_TYPES,
  showTypeFilters = true
}) {
  const [eventTypeFilter, setEventTypeFilter] = useState(defaultEventTypeFilter);
  const [expandedDescriptions, setExpandedDescriptions] = useState({});

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

  useEffect(() => {
    setEventTypeFilter(defaultEventTypeFilter);
  }, [defaultEventTypeFilter]);

  function toggleDescription(eventId) {
    setExpandedDescriptions((current) => ({
      ...current,
      [eventId]: !current[eventId]
    }));
  }

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
      {showTypeFilters ? (
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
      ) : null}
      {!filteredEvents.length ? (
        <div className="empty-state compact-empty-state">
          <h2>No matching events</h2>
          <p>Try a different event type filter.</p>
        </div>
      ) : null}
      {filteredEvents.map((event) => (
        <article className="event-admin-card" key={event.id}>
          <div className="event-admin-card-main">
            <div className="card-kicker">
              <span>{event.eventType || 'Type TBD'}</span>
              <strong>{event.status}</strong>
            </div>
            <h3>{event.title || 'Untitled Draft'}</h3>
            {event.description ? (
              <div className="event-card-description">
                <p>
                  {expandedDescriptions[event.id] || event.description.length <= DESCRIPTION_PREVIEW_LENGTH
                    ? event.description
                    : `${event.description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trim()}...`}
                </p>
                {event.description.length > DESCRIPTION_PREVIEW_LENGTH ? (
                  <button
                    className="text-button event-description-toggle"
                    type="button"
                    onClick={() => toggleDescription(event.id)}
                  >
                    {expandedDescriptions[event.id] ? 'Hide Description' : 'Show Full Description'}
                  </button>
                ) : null}
              </div>
            ) : (
              <p>Description TBD</p>
            )}
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
                <dt>Presenter</dt>
                <dd>{event.presenter || 'To be announced'}</dd>
              </div>
              <div>
                <dt>Capacity</dt>
                <dd>
                  {event.capacityUnlimited ? 'Unlimited' : event.capacity ? `${event.capacity}` : 'Capacity TBD'}
                </dd>
              </div>
              <div>
                <dt>Cost</dt>
                <dd>
                  {event.isPaid ? formatCurrency(event.cost) : 'Free'} plus{' '}
                  {formatCurrency(event.serviceFee)} fee
                </dd>
              </div>
              <div>
                <dt>Listing</dt>
                <dd>
                  {event.listingMode === 'future'
                    ? 'Scheduled for later'
                    : event.listingMode === 'now'
                      ? 'Listed now'
                      : 'Listing TBD'}
                </dd>
              </div>
              {event.visibleFrom ? (
                <div>
                  <dt>Listing Starts</dt>
                  <dd>{new Date(event.visibleFrom).toLocaleString()}</dd>
                </div>
              ) : null}
              {event.visibleUntil ? (
                <div>
                  <dt>Listing Ends</dt>
                  <dd>{new Date(event.visibleUntil).toLocaleString()}</dd>
                </div>
              ) : null}
              {event.registrationMode ? (
                <div>
                  <dt>Registration</dt>
                  <dd>
                    {event.registrationMode === 'future'
                      ? 'Scheduled for later'
                      : event.registrationMode === 'now'
                        ? 'Open now'
                        : 'Closed'}
                  </dd>
                </div>
              ) : null}
              {event.registrationOpenAt ? (
                <div>
                  <dt>Registration Opens</dt>
                  <dd>{new Date(event.registrationOpenAt).toLocaleString()}</dd>
                </div>
              ) : null}
              {event.registrationCloseAt ? (
                <div>
                  <dt>Registration Closes</dt>
                  <dd>{new Date(event.registrationCloseAt).toLocaleString()}</dd>
                </div>
              ) : null}
              {event.businessName ? (
                <div>
                  <dt>Business Name</dt>
                  <dd>{event.businessName}</dd>
                </div>
              ) : null}
              {event.ownerName ? (
                <div>
                  <dt>Owner Name</dt>
                  <dd>{event.ownerName}</dd>
                </div>
              ) : null}
              {event.specialty ? (
                <div>
                  <dt>Specialty</dt>
                  <dd>{event.specialty}</dd>
                </div>
              ) : null}
              {event.contactEmail ? (
                <div>
                  <dt>Contact Email</dt>
                  <dd>{event.contactEmail}</dd>
                </div>
              ) : null}
              {event.contactPhone ? (
                <div>
                  <dt>Contact Phone</dt>
                  <dd>{event.contactPhone}</dd>
                </div>
              ) : null}
              {event.address ? (
                <div>
                  <dt>Address</dt>
                  <dd>{event.address}</dd>
                </div>
              ) : null}
              {event.askingPrice ? (
                <div>
                  <dt>Asking Price</dt>
                  <dd>{formatCurrency(event.askingPrice)}</dd>
                </div>
              ) : null}
              {event.supplyListTitle || event.documentTitle ? (
                <div>
                  <dt>Documents</dt>
                  <dd>{event.supplyListTitle || event.documentTitle}</dd>
                </div>
              ) : null}
            </dl>
          </div>
          <div className="public-event-card-thumbnail event-admin-card-thumbnail">
            {event.imageUrls?.[0] ? (
              <img alt={`${event.title || 'Event'} thumbnail`} src={event.imageUrls[0]} />
            ) : (
              <div className="image-placeholder" aria-label="No image uploaded" />
            )}
          </div>
          <div className="card-actions">
            <button className="button-link button-reset compact-action" type="button" onClick={() => onEdit(event)}>
              Edit
            </button>
            <button
              className="danger-button"
              title={isSuperUser ? 'Permanently delete this event' : 'Archive this event'}
              type="button"
              onClick={() => onDelete(event)}
            >
              {isSuperUser ? 'Delete' : 'Archive'}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export default EventList;
