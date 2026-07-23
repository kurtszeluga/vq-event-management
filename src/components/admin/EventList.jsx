import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  formatCurrency,
  formatEventDate,
  formatRegistrationDateRange,
  formatTimeRange,
  getRegistrationEndDate,
  getRegistrationStartDate
} from '../../utils/eventFormat.js';
import { getRegistrationAvailability } from '../../utils/registrationAvailability.js';

const ALL_TYPES = 'All';
const EVENT_STATUS_FILTERS = ['Active', 'Archived'];
const DESCRIPTION_PREVIEW_LENGTH = 180;
const CLASS_TYPES = ['Class (Half Day)', 'Class (Full Day)'];
const DEFAULT_TYPE_FILTERS = [
  { label: ALL_TYPES, value: ALL_TYPES, types: [] },
  { label: 'Classes', value: 'Classes', types: CLASS_TYPES },
  { label: 'Workshop', value: 'Workshop', types: ['Workshop'] },
  { label: 'Lecture', value: 'Lecture', types: ['Lecture'] },
  { label: 'Retreat', value: 'Retreat', types: ['Retreat'] },
  { label: 'Other', value: 'Other', types: ['Other'] }
];

function EventList({
  events,
  loading,
  onDelete,
  onEdit,
  registrationCounts = {},
  lastSavedEventId = '',
  defaultEventTypeFilter = ALL_TYPES,
  showTypeFilters = true,
  excludedEventTypes = []
}) {
  const excludedTypes = useMemo(() => new Set(excludedEventTypes), [excludedEventTypes]);
  const [eventTypeFilter, setEventTypeFilter] = useState(defaultEventTypeFilter);
  const [eventStatusFilter, setEventStatusFilter] = useState('Active');
  const [expandedDescriptions, setExpandedDescriptions] = useState({});
  const [now, setNow] = useState(Date.now());
  const eventTypeFilters = useMemo(
    () =>
      DEFAULT_TYPE_FILTERS.filter((filter) =>
        filter.value === ALL_TYPES || filter.types.some((type) => !excludedTypes.has(type))
      ),
    [excludedTypes]
  );
  const eventTypeFilterMap = useMemo(
    () => new Map(eventTypeFilters.map((filter) => [filter.value, filter])),
    [eventTypeFilters]
  );

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
        const matchingFilter = eventTypeFilters.find(
          (filter) => filter.value !== ALL_TYPES && filter.types.includes(type)
        );

        if (!matchesEventStatus(event, eventStatusFilter)) {
          return counts;
        }

        return matchingFilter
          ? { ...counts, [matchingFilter.value]: counts[matchingFilter.value] + 1 }
          : counts;
      }, Object.fromEntries(eventTypeFilters.map((filter) => [filter.value, 0]))),
    [eventStatusFilter, eventTypeFilters, moduleEvents]
  );
  const eventStatusCounts = useMemo(
    () =>
      moduleEvents.reduce(
        (counts, event) => {
          const type = event.eventType || 'Other';

          if (showTypeFilters && !matchesEventTypeFilter(type, eventTypeFilter, eventTypeFilterMap)) {
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
    [eventTypeFilter, eventTypeFilterMap, moduleEvents, showTypeFilters]
  );
  const allTypeCount = useMemo(
    () => moduleEvents.filter((event) => matchesEventStatus(event, eventStatusFilter)).length,
    [eventStatusFilter, moduleEvents]
  );
  const filteredEvents = useMemo(
    () =>
      moduleEvents
        .filter((event) => matchesEventStatus(event, eventStatusFilter))
        .filter((event) =>
          !showTypeFilters
            ? true
            : matchesEventTypeFilter(event.eventType || 'Other', eventTypeFilter, eventTypeFilterMap)
        ),
    [eventStatusFilter, eventTypeFilter, eventTypeFilterMap, moduleEvents, showTypeFilters]
  );

  useEffect(() => {
    setEventTypeFilter(defaultEventTypeFilter);
  }, [defaultEventTypeFilter]);

  useEffect(() => {
    setEventStatusFilter('Active');
  }, [defaultEventTypeFilter]);

  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(intervalId);
  }, []);

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
        <p>Use the Create button above to add the first record for this card.</p>
      </div>
    );
  }

  return (
      <div className="event-admin-list">
      <div className="status-filter-group separated-filter-row" aria-label="Event status filters">
          {EVENT_STATUS_FILTERS.map((status) => (
            <button
              className={`status-filter-button${eventStatusFilter === status ? ' active' : ''}${status === 'Archived' && eventStatusFilter === status ? ' archive-active' : ''}`}
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
          {eventTypeFilters.map((filter) => (
            <button
              className={`status-filter-button${eventTypeFilter === filter.value ? ' active' : ''}`}
              key={filter.value}
              type="button"
              onClick={() => setEventTypeFilter(filter.value)}
            >
              {filter.value === ALL_TYPES
                ? `All (${allTypeCount})`
                : `${filter.label} (${eventTypeCounts[filter.value] || 0})`}
            </button>
          ))}
        </div>
      ) : null}
      {!filteredEvents.length ? (
        <div className="empty-state compact-empty-state">
          <h2>No matching events</h2>
          <p>Try Active or Archived, or choose a different type filter.</p>
        </div>
      ) : null}
      {filteredEvents.map((event) => {
        const wasLastSaved = lastSavedEventId && event.id === lastSavedEventId;
        const counts = registrationCounts[event.id] || {};
        const availability = getRegistrationAvailability(event, counts);
        const registrationStats = getEventRegistrationStats(event, counts);
        const holdTimeLeft = formatHoldTimeLeft(counts.heldExpiresAt, now);

        return (
          <article className={`event-admin-card${wasLastSaved ? ' recently-saved-card' : ''}`} key={event.id}>
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
            <div className="event-registration-pill-row" aria-label="Registration statistics">
              {registrationStats.map((stat) => (
                <span
                  className={`event-registration-pill${stat.tone ? ` ${stat.tone}` : ''}`}
                  key={stat.label}
                >
                  <strong>{stat.value}</strong>
                  {stat.label}
                </span>
              ))}
              {Number(counts.held || 0) ? (
                <span className="event-registration-pill hold">
                  <strong>{Number(counts.held || 0)}</strong>
                  {holdTimeLeft ? `Held (${holdTimeLeft})` : 'Held'}
                </span>
              ) : null}
            </div>
            <dl>
              <div>
                <dt>Date</dt>
                <dd>{formatEventDate(event.date)}</dd>
              </div>
              {event.eventType !== 'Challenges' ? (
                <div>
                  <dt>Time</dt>
                  <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
                </div>
              ) : null}
              <div>
                <dt>Location</dt>
                <dd>{event.location || 'Location TBD'}</dd>
              </div>
              <div>
                <dt>Presenter</dt>
                <dd>{event.presenter || 'To be announced'}</dd>
              </div>
              <div>
                <dt>Payment Details</dt>
                <dd>
                  {event.isPaid ? (
                    <>
                      <span>{formatCurrency(event.cost || 0)} cost</span>
                      <span> + {formatCurrency(event.serviceFee || 0)} service fee</span>
                      <span> = {formatCurrency(getEventPaymentTotal(event))} total</span>
                      <br />
                      <span>
                        Cash/check later: {event.allowCashCheckPayment ? 'Allowed' : 'Not allowed'}
                      </span>
                    </>
                  ) : (
                    'No Charge'
                  )}
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
                  <dd>{formatListingEnd(event)}</dd>
                </div>
              ) : null}
              {getRegistrationStartDate(event) || getRegistrationEndDate(event) ? (
                <div>
                  <dt>Registration Open/Closes</dt>
                  <dd>{formatRegistrationDateRange(event)}</dd>
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
            {wasLastSaved ? <span className="recently-saved-flag">Saved</span> : null}
            {canRegisterEvent(event) ? (
              <Link
                className="button-link secondary-action"
                to={`/register?eventId=${event.id}`}
              >
                {availability.isFull ? 'Join Waitlist' : 'Register'}
              </Link>
            ) : null}
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
        );
      })}
    </div>
  );
}

function matchesEventStatus(event, statusFilter) {
  return statusFilter === 'Archived'
    ? event.status === 'Archived'
    : event.status !== 'Archived';
}

function matchesEventTypeFilter(type, filterValue, filterMap) {
  if (filterValue === ALL_TYPES) {
    return true;
  }

  const filter = filterMap.get(filterValue);

  return filter ? filter.types.includes(type) : type === filterValue;
}

function getEventPaymentTotal(event) {
  return Number(event.cost || 0) + Number(event.serviceFee || 0);
}

function canRegisterEvent(event) {
  return event.status !== 'Archived'
    && event.registrationOpen
    && !['Business Listing', 'For Sale'].includes(event.eventType);
}

function getEventRegistrationStats(event, counts = {}) {
  const registered = Number(counts.registered || 0);
  const pendingPayment = Number(counts.pendingPayment || 0);
  const waitlisted = Number(counts.waitlisted || 0);

  if (event.capacityUnlimited) {
    return [
      { label: 'Capacity', value: 'Unlimited' },
      { label: 'Registered', value: String(registered), tone: registered ? 'active' : '' },
      { label: 'Pending Payment', value: String(pendingPayment), tone: pendingPayment ? 'waitlist' : '' },
      { label: 'Waitlisted', value: String(waitlisted), tone: waitlisted ? 'waitlist' : '' },
      { label: 'Open Seats', value: 'Unlimited', tone: 'open' }
    ];
  }

  const capacity = Number(event.capacity || 0);
  const held = Number(counts.held || 0);
  const openSeats = capacity ? Math.max(capacity - registered - pendingPayment - held, 0) : null;

  return [
    { label: 'Capacity', value: capacity ? String(capacity) : 'Not Set' },
    { label: 'Registered', value: String(registered), tone: registered ? 'active' : '' },
    { label: 'Pending Payment', value: String(pendingPayment), tone: pendingPayment ? 'waitlist' : '' },
    { label: 'Waitlisted', value: String(waitlisted), tone: waitlisted ? 'waitlist' : '' },
    {
      label: 'Open Seats',
      value: openSeats === null ? 'N/A' : String(openSeats),
      tone: openSeats === 0 && capacity ? 'full' : 'open'
    }
  ];
}

function formatListingEnd(event) {
  const date = new Date(event.visibleUntil);

  if (Number.isNaN(date.getTime())) {
    return event.visibleUntil;
  }

  return event.eventType === 'Challenges'
    ? date.toLocaleDateString()
    : date.toLocaleString();
}

function formatHoldTimeLeft(expiresAt, now) {
  if (!expiresAt) {
    return '';
  }

  const millisLeft = Date.parse(expiresAt) - now;

  if (millisLeft <= 0) {
    return '';
  }

  const minutes = Math.floor(millisLeft / 60000);
  const seconds = Math.floor((millisLeft % 60000) / 1000);

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export default EventList;
