import { useEffect, useMemo, useState } from 'react';
import EventImageCarousel from './EventImageCarousel.jsx';
import PageHeader from './PageHeader.jsx';
import { subscribeToPublishedEvents } from '../services/eventService.js';
import { buildListingDetails, getListingTitle, isEventVisible } from '../utils/eventFormat.js';

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
          const titleText = getListingTitle(event);
          const details = buildListingDetails(event);

          return (
            <article className="public-event-card public-listing-card" key={event.id}>
              <div className="card-kicker">
                <span className="event-type-pill">{eventType}</span>
                {event.businessTypeLabel ? (
                  <span className="business-type-pill">{event.businessTypeLabel}</span>
                ) : null}
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
                      <dd>{renderDetailValue(detail)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
              <div className="public-event-card-thumbnail">
                <EventImageCarousel
                  altText={`${titleText} thumbnail`}
                  businessType={event.businessType}
                  eventType={event.eventType}
                  imageUrls={event.imageUrls}
                />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function getDescriptionPreview(description) {
  if (description.length <= DESCRIPTION_PREVIEW_LENGTH) {
    return description;
  }

  return `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trim()}...`;
}

function renderDetailValue(detail) {
  if (detail.link === 'email') {
    return <a href={`mailto:${detail.value}`}>{detail.value}</a>;
  }

  if (detail.link === 'phone') {
    return <a href={`tel:${detail.value.replace(/[^0-9+]/g, '')}`}>{detail.value}</a>;
  }

  // detail.href carries the scheme-normalized URL; detail.value is the host
  // on its own, which is what a reader recognises.
  if (detail.link === 'website') {
    return (
      <a href={detail.href} rel="noopener noreferrer" target="_blank">
        {detail.value}
      </a>
    );
  }

  return detail.value;
}

export default PublicListingPage;
