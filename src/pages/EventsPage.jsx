import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { subscribeToPublishedEvents } from '../services/eventService.js';
import { loadPublicRegistrationCounts } from '../services/registrationService.js';
import {
  formatCurrency,
  formatEventDate,
  formatTimeRange,
  isEventVisible
} from '../utils/eventFormat.js';
import { getRegistrationAvailability } from '../utils/registrationAvailability.js';

const DESCRIPTION_PREVIEW_LENGTH = 180;
const EXCLUDED_EVENT_TYPES = new Set(['Business Listing', 'For Sale']);
const EVENT_TYPE_FILTERS = [
  {
    label: 'Programs',
    value: 'Programs',
    types: ['Class (Half Day)', 'Class (Full Day)', 'Lecture', 'Retreat']
  },
  {
    label: 'Workshops',
    value: 'Workshops',
    types: ['Workshop']
  },
  {
    label: 'Challenges',
    value: 'Challenges',
    types: ['Challenges']
  }
];
const DEFAULT_EVENT_TYPE_FILTER = EVENT_TYPE_FILTERS[0].value;

function getEventTypeLabel(event) {
  return event.eventType || 'Other';
}

function getEventThumbnail(event) {
  return event.imageUrls?.find(Boolean) || '';
}

function getEventFilter(type) {
  return EVENT_TYPE_FILTERS.find((filter) => filter.types.includes(type)) || null;
}

function getDescriptionPreview(description) {
  if (!description || description.length <= DESCRIPTION_PREVIEW_LENGTH) {
    return description;
  }

  return `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trim()}...`;
}

function openSupplyListPopup(event) {
  if (!event?.supplyListUrl) {
    return;
  }

  window.open(`/events/${event.id}/supply-list`, 'vq-supply-list', 'popup,width=1100,height=900');
}

function openEventPrintView(event) {
  if (!event?.id) {
    return;
  }

  const popup = window.open('', 'vq-event-print', 'popup,width=1100,height=900');

  if (!popup) {
    return;
  }

  const printWindow = popup;
  const html = buildEventPrintHtml(event);

  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  printWindow.focus();
}

function buildEventPrintHtml(event) {
  const title = escapeHtml(event.title || 'Event');
  const eventType = escapeHtml(getEventTypeLabel(event));
  const description = event.description ? `<p class="description">${escapeHtml(event.description)}</p>` : '';
  const date = escapeHtml(formatEventDate(event.date));
  const time = escapeHtml(formatTimeRange(event.startTime, event.endTime));
  const location = escapeHtml(event.location || 'To be announced');
  const presenter = escapeHtml(event.presenter || 'To be announced');
  const cost = escapeHtml(event.isPaid ? formatCurrency(event.cost) : 'Free');
  const registration = event.registrationOpen ? 'Registration open' : 'Registration closed';
  const imageUrl = event.imageUrls?.find(Boolean) || '';
  const imageBlock = imageUrl
    ? `<div class="image-wrap"><img alt="${title} thumbnail" src="${escapeHtml(imageUrl)}" /></div>`
    : '<div class="image-wrap image-placeholder" aria-label="No image uploaded"></div>';

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Print ${title}</title>
      <style>
        :root {
          color: #1d2927;
          background: #ffffff;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        html, body {
          margin: 0;
          padding: 0;
        }
        body {
          padding: 32px 28px 40px;
        }
        .page {
          margin: 0 auto;
          max-width: 760px;
        }
        .topbar {
          align-items: flex-start;
          display: flex;
          justify-content: space-between;
          gap: 16px;
          margin-bottom: 22px;
        }
        .eyebrow {
          color: #9a4d2f;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          margin: 0 0 8px;
          text-transform: uppercase;
        }
        h1 {
          font-size: 28px;
          line-height: 1.15;
          margin: 0;
        }
        .meta {
          display: grid;
          gap: 12px;
          margin: 20px 0 0;
        }
        .meta-row {
          display: grid;
          grid-template-columns: 120px 1fr;
          gap: 12px;
        }
        .meta-label {
          font-weight: 800;
        }
        .pill {
          display: inline-flex;
          align-items: center;
          background: #e9f2ef;
          border: 1px solid #c6dad5;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          padding: 6px 10px;
        }
        .image-wrap {
          border: 1px solid #ded5ca;
          border-radius: 8px;
          margin-top: 18px;
          overflow: hidden;
          width: 180px;
        }
        .image-wrap img {
          display: block;
          height: 180px;
          object-fit: cover;
          width: 100%;
        }
        .image-placeholder {
          background: linear-gradient(135deg, #f6efe9, #ebe3da);
          height: 180px;
        }
        .actions {
          display: inline-flex;
          gap: 8px;
          margin-top: 4px;
        }
        button {
          appearance: none;
          border: 1px solid #225c56;
          border-radius: 8px;
          background: #225c56;
          color: #fff;
          cursor: pointer;
          font: inherit;
          font-weight: 700;
          padding: 10px 14px;
        }
        button.secondary {
          background: #fff;
          color: #225c56;
        }
        .description {
          white-space: pre-wrap;
          line-height: 1.55;
          margin: 16px 0 0;
        }
        @media print {
          body {
            padding: 0;
          }
          .actions {
            display: none;
          }
        }
      </style>
    </head>
    <body onload="window.setTimeout(function () { window.print(); }, 150)">
      <main class="page">
        <div class="topbar">
          <div>
            <p class="eyebrow">Event listing</p>
            <h1>${title}</h1>
          </div>
          <div class="actions">
            <button type="button" onclick="window.print()">Print</button>
            <button type="button" class="secondary" onclick="window.close()">Close</button>
          </div>
        </div>
        <div class="pill">${eventType}</div>
        <div class="meta">
          <div class="meta-row"><div class="meta-label">Status</div><div>${registration}</div></div>
          <div class="meta-row"><div class="meta-label">Date</div><div>${date}</div></div>
          <div class="meta-row"><div class="meta-label">Time</div><div>${time}</div></div>
          <div class="meta-row"><div class="meta-label">Location</div><div>${location}</div></div>
          <div class="meta-row"><div class="meta-label">Presenter</div><div>${presenter}</div></div>
          <div class="meta-row"><div class="meta-label">Cost</div><div>${cost}</div></div>
        </div>
        ${imageBlock}
        ${description}
      </main>
    </body>
  </html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function EventsPage() {
  const [coordinatorContacts, setCoordinatorContacts] = useState({});
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
  const [eventTypeFilter, setEventTypeFilter] = useState(DEFAULT_EVENT_TYPE_FILTER);
  const [expandedDescriptions, setExpandedDescriptions] = useState({});
  const [loading, setLoading] = useState(true);
  const [registrationCounts, setRegistrationCounts] = useState({});

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

  useEffect(() => {
    let active = true;

    Promise.all(
      ['events', 'challenges'].map((category) =>
        fetch(`/api/public-events?category=${category}`)
          .then((response) => (response.ok ? response.json() : { events: [] }))
      )
    )
      .then((payloads) => {
        if (!active) {
          return;
        }

        const contacts = payloads
          .flatMap((payload) => payload.events || [])
          .reduce((nextContacts, event) => {
            if (event.id && (event.coordinatorName || event.coordinatorEmail)) {
              return {
                ...nextContacts,
                [event.id]: {
                  email: event.coordinatorEmail || '',
                  name: event.coordinatorName || ''
                }
              };
            }

            return nextContacts;
          }, {});

        setCoordinatorContacts(contacts);
      })
      .catch(() => {
        if (active) {
          setCoordinatorContacts({});
        }
      });

    return () => {
      active = false;
    };
  }, []);

  const visibleEvents = useMemo(() => events.filter(isEventVisible), [events]);
  const registerableEvents = useMemo(
    () =>
      visibleEvents.filter((event) => {
        const type = getEventTypeLabel(event);
        return !EXCLUDED_EVENT_TYPES.has(type) && Boolean(getEventFilter(type));
      }),
    [visibleEvents]
  );
  const eventTypeCounts = useMemo(
    () =>
      registerableEvents.reduce((counts, event) => {
        const filter = getEventFilter(getEventTypeLabel(event));
        return filter
          ? { ...counts, [filter.value]: counts[filter.value] + 1 }
          : counts;
      }, Object.fromEntries(EVENT_TYPE_FILTERS.map((filter) => [filter.value, 0]))),
    [registerableEvents]
  );
  const eventTypeFilters = useMemo(
    () => EVENT_TYPE_FILTERS,
    []
  );
  const filteredEvents = useMemo(
    () =>
      registerableEvents.filter((event) =>
        getEventFilter(getEventTypeLabel(event))?.value === eventTypeFilter
      ),
    [eventTypeFilter, registerableEvents]
  );

  useEffect(() => {
    if (!eventTypeFilters.some((filter) => filter.value === eventTypeFilter)) {
      setEventTypeFilter(DEFAULT_EVENT_TYPE_FILTER);
    }
  }, [eventTypeFilter, eventTypeFilters]);

  useEffect(() => {
    const eventIds = registerableEvents.map((event) => event.id).filter(Boolean);
    let active = true;

    if (!eventIds.length) {
      setRegistrationCounts({});
      return undefined;
    }

    loadPublicRegistrationCounts(eventIds)
      .then((counts) => {
        if (active) {
          setRegistrationCounts(counts);
        }
      })
      .catch(() => {
        if (active) {
          setRegistrationCounts({});
        }
      });

    return () => {
      active = false;
    };
  }, [registerableEvents]);

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
        description="Browse upcoming classes, workshops, retreats, lectures, challenges, and other registerable activities."
      />
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? (
        <div className="empty-state">
          <h2>Loading events</h2>
          <p>Retrieving published events.</p>
        </div>
      ) : null}
      {!loading && !registerableEvents.length ? (
        <div className="empty-state">
          <h2>No published registerable events yet</h2>
          <p>Registerable events will be listed here when they are ready.</p>
        </div>
      ) : null}
      {!loading && registerableEvents.length ? (
        <div className="status-filter-group event-type-filter" aria-label="Event type filters">
          {eventTypeFilters.map((filter) => (
            <button
              className={`status-filter-button${eventTypeFilter === filter.value ? ' active' : ''}`}
              key={filter.value}
              onClick={() => setEventTypeFilter(filter.value)}
              type="button"
            >
              {filter.label} ({eventTypeCounts[filter.value] || 0})
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
          const availability = getRegistrationAvailability(event, registrationCounts[event.id]);
          const coordinatorContact = coordinatorContacts[event.id];

          return (
            <article className="public-event-card" key={event.id}>
              <div className="card-kicker">
                <span className="event-type-pill">{getEventTypeLabel(event)}</span>
                <strong className={`event-availability-pill ${availability.tone}`}>
                  {availability.label}
                </strong>
                <strong>
                  {event.registrationOpen ? 'Registration open' : 'Registration closed'}
                </strong>
              </div>
              <div className="public-event-card-main">
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
                {coordinatorContact ? (
                  <p className="event-coordinator-contact">
                    <strong>For Questions Contact:</strong> {coordinatorContact.name || 'To be announced'}
                    {coordinatorContact.email ? (
                      <>
                        {' '}
                        <a href={`mailto:${coordinatorContact.email}`}>{coordinatorContact.email}</a>
                      </>
                    ) : null}
                  </p>
                ) : null}
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
                  <button
                    className="button-link secondary-action"
                    type="button"
                    onClick={() => openSupplyListPopup(event)}
                  >
                    View, print, or save{' '}
                    {event.supplyListTitle || event.supplyListFileName || 'supply list'}
                  </button>
                ) : null}
                <button
                  className="button-link secondary-action"
                  type="button"
                  onClick={() => openEventPrintView(event)}
                >
                  Print the {getEventTypeLabel(event)}
                </button>
                {event.registrationOpen ? (
                  <Link
                    className="button-link public-event-register-action"
                    to={`/register?eventId=${event.id}`}
                  >
                    {availability.isFull ? 'Join Waitlist' : 'Register'}
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
