import { useEffect, useMemo, useState } from 'react';
import { EVENT_TYPES } from '../../data/eventOptions.js';
import { formatCurrency, formatEventDate, formatTimeRange } from '../../utils/eventFormat.js';

const ALL_TYPES = 'All';
const EVENT_STATUS_FILTERS = ['Active', 'Archived'];
const DESCRIPTION_PREVIEW_LENGTH = 180;
const FILTER_TYPES = [
  'All',
  ...EVENT_TYPES
];

function EventList({
  events,
  loading,
  onDelete,
  onEdit,
  defaultEventTypeFilter = ALL_TYPES,
  showTypeFilters = true,
  excludedEventTypes = []
}) {
  const excludedTypes = useMemo(() => new Set(excludedEventTypes), [excludedEventTypes]);
  const [eventTypeFilter, setEventTypeFilter] = useState(defaultEventTypeFilter);
  const [eventStatusFilter, setEventStatusFilter] = useState('Active');
  const [expandedDescriptions, setExpandedDescriptions] = useState({});

  const moduleEvents = useMemo(
    () =>
      events.filter((event) => {
        const type = event.eventType || 'Other';

        if (excludedTypes.has(type)) {
          return false;
        }

        return showTypeFilters || defaultEventTypeFilter === ALL_TYPES
          ? true
          : type === defaultEventTypeFilter;
      }),
    [defaultEventTypeFilter, events, excludedTypes, showTypeFilters]
  );
  const eventTypeCounts = useMemo(
    () =>
      moduleEvents.reduce((counts, event) => {
        const type = event.eventType || 'Other';

        if (!matchesEventStatus(event, eventStatusFilter)) {
          return counts;
        }

        return type in counts ? { ...counts, [type]: counts[type] + 1 } : counts;
      }, Object.fromEntries(FILTER_TYPES.slice(1).map((type) => [type, 0]))),
    [eventStatusFilter, moduleEvents]
  );
  const eventStatusCounts = useMemo(
    () =>
      moduleEvents.reduce(
        (counts, event) => {
          const type = event.eventType || 'Other';

          if (showTypeFilters && eventTypeFilter !== ALL_TYPES && type !== eventTypeFilter) {
            return counts;
          }

          if (event.status === 'Archived') {
            counts.archived += 1;
          } else {
            counts.active += 1;
          }

          return counts;
        },
        { active: 0, archived: 0 }
      ),
    [eventTypeFilter, moduleEvents, showTypeFilters]
  );
  const allTypeCount = useMemo(
    () => moduleEvents.filter((event) => matchesEventStatus(event, eventStatusFilter)).length,
    [eventStatusFilter, moduleEvents]
  );
  const eventTypeFilters = useMemo(
    () => FILTER_TYPES,
    []
  );
  const filteredEvents = useMemo(
    () =>
      moduleEvents
        .filter((event) => matchesEventStatus(event, eventStatusFilter))
        .filter((event) =>
          !showTypeFilters || eventTypeFilter === ALL_TYPES
            ? true
            : (event.eventType || 'Other') === eventTypeFilter
        ),
    [eventStatusFilter, eventTypeFilter, moduleEvents, showTypeFilters]
  );

  useEffect(() => {
    setEventTypeFilter(defaultEventTypeFilter);
  }, [defaultEventTypeFilter]);

  useEffect(() => {
    setEventStatusFilter('Active');
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
      <div className="status-filter-group separated-filter-row" aria-label="Event status filters">
          {EVENT_STATUS_FILTERS.map((status) => (
            <button
              className={`status-filter-button${eventStatusFilter === status ? ' active' : ''}`}
              key={status}
              type="button"
              onClick={() => setEventStatusFilter(status)}
            >
              {status} ({eventStatusCounts[status.toLowerCase()] || 0})
            </button>
          ))}
        </div>
      {showTypeFilters ? (
        <div className="status-filter-group separated-filter-row" aria-label="Event type filters">
          {eventTypeFilters.map((type) => (
            <button
              className={`status-filter-button${eventTypeFilter === type ? ' active' : ''}`}
              key={type}
              type="button"
              onClick={() => setEventTypeFilter(type)}
            >
              {type === ALL_TYPES ? `All (${allTypeCount})` : `${type} (${eventTypeCounts[type] || 0})`}
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
            <button className="button-link button-reset" type="button" onClick={() => onEdit(event)}>
              Edit
            </button>
            <button
              className={event.status === 'Archived'
                ? 'button-link button-reset secondary-action archive-action'
                : 'danger-button archive-action'}
              title={event.status === 'Archived' ? 'Reactivate this listing' : 'Archive this listing'}
              type="button"
              onClick={() => onDelete(event)}
            >
              {event.status === 'Archived' ? 'Reactivate' : 'Archive'}
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function matchesEventStatus(event, statusFilter) {
  return statusFilter === 'Archived'
    ? event.status === 'Archived'
    : event.status !== 'Archived';
}

export default EventList;
