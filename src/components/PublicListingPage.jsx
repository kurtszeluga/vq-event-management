import { useEffect, useMemo, useState } from 'react';
import PageHeader from './PageHeader.jsx';
import { subscribeToPublishedEvents } from '../services/eventService.js';
import { formatCurrency, isEventVisible } from '../utils/eventFormat.js';

const DESCRIPTION_PREVIEW_LENGTH = 180;

function PublicListingPage({
  eventType,
  eyebrow,
  title,
  description,
  emptyTitle,
  emptyDescription
}) {
  const [events, setEvents] = useState([]);
  const [error, setError] = useState('');
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

  const visibleEvents = useMemo(
    () => events.filter((event) => isEventVisible(event) && event.eventType === eventType),
    [eventType, events]
  );

  function toggleDescription(eventId) {
    setExpandedDescriptions((current) => ({
      ...current,
      [eventId]: !current[eventId]
    }));
  }

  return (
    <section>
      <PageHeader eyebrow={eyebrow} title={title} description={description} />
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? (
        <div className="empty-state">
          <h2>Loading listings</h2>
          <p>Retrieving published listings.</p>
        </div>
      ) : null}
      {!loading && !visibleEvents.length ? (
        <div className="empty-state">
          <h2>{emptyTitle}</h2>
          <p>{emptyDescription}</p>
        </div>
      ) : null}
      <div className="public-event-list">
        {visibleEvents.map((event) => {
          const descriptionText = event.description || '';
          const descriptionIsLong = descriptionText.length > DESCRIPTION_PREVIEW_LENGTH;
          const descriptionExpanded = Boolean(expandedDescriptions[event.id]);
          const titleText =
            eventType === 'Business Listing'
              ? event.businessName || event.title || 'Business Listing'
              : event.title || 'For Sale Listing';
          const details = buildListingDetails(event, eventType);

          return (
            <article className="public-event-card public-listing-card" key={event.id}>
              <div className="card-kicker">
                <span className="event-type-pill">{eventType}</span>
              </div>
              <div className="public-event-card-main">
                <h2>{titleText}</h2>
                {descriptionText ? (
                  <div className="event-card-description">
                    <p>
                      {descriptionExpanded
                        ? descriptionText
                        : getDescriptionPreview(descriptionText)}
                    </p>
                    {descriptionIsLong ? (
                      <button
                        className="text-button event-description-toggle"
                        type="button"
                        onClick={() => toggleDescription(event.id)}
                      >
                        {descriptionExpanded ? 'Hide Description' : 'Show Full Description'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
                <dl>
                  {details.map((detail) => (
                    <div key={detail.label}>
                      <dt>{detail.label}</dt>
                      <dd>{detail.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="public-event-card-thumbnail">
                {event.imageUrls?.[0] ? (
                  <img alt={`${titleText} thumbnail`} src={event.imageUrls[0]} />
                ) : (
                  <div className="image-placeholder" aria-label="No image uploaded" />
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function buildListingDetails(event, eventType) {
  if (eventType === 'Business Listing') {
    return [
      { label: 'Owner', value: event.ownerName || 'Owner TBD' },
      { label: 'Business', value: event.businessName || 'Business TBD' },
      { label: 'Specialty', value: event.specialty || 'Specialty TBD' },
      { label: 'Email', value: renderLink(event.contactEmail, 'email') },
      { label: 'Phone', value: renderLink(event.contactPhone, 'phone') },
      { label: 'Address', value: event.address || 'Address TBD' }
    ];
  }

  return [
    { label: 'Asking Price', value: formatCurrency(event.askingPrice) },
    { label: 'Contact', value: event.contactName || 'Contact TBD' },
    { label: 'Email', value: renderLink(event.contactEmail, 'email') },
    { label: 'Phone', value: renderLink(event.contactPhone, 'phone') },
    { label: 'Posting Starts', value: formatListingDateTime(event.visibleFrom) },
    { label: 'Posting Ends', value: formatListingDateTime(event.visibleUntil) }
  ];
}

function getDescriptionPreview(description) {
  if (description.length <= DESCRIPTION_PREVIEW_LENGTH) {
    return description;
  }

  return `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trim()}...`;
}

function renderLink(value, type) {
  if (!value) {
    return type === 'email' ? 'Email TBD' : 'Phone TBD';
  }

  if (type === 'email') {
    return <a href={`mailto:${value}`}>{value}</a>;
  }

  const phoneHref = `tel:${value.replace(/[^0-9+]/g, '')}`;
  return <a href={phoneHref}>{value}</a>;
}

function formatListingDateTime(value) {
  if (!value) {
    return 'TBD';
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
}

export default PublicListingPage;
