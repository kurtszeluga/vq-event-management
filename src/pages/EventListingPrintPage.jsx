import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { getEvent } from '../services/eventService.js';
import {
  formatCurrency,
  formatEventDate,
  formatTimeRange,
  isEventVisible
} from '../utils/eventFormat.js';

function EventListingPrintPage() {
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const cacheKey = searchParams.get('cacheKey');
  const [event, setEvent] = useState(() => readCachedEvent(cacheKey));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(() => !readCachedEvent(cacheKey));

  useEffect(() => {
    if (event) {
      return undefined;
    }

    let active = true;

    async function loadEvent() {
      try {
        const eventRecord = await getEvent(eventId);

        if (active) {
          setEvent(eventRecord);
          setError('');
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    loadEvent();

    return () => {
      active = false;
    };
  }, [event, eventId]);

  useEffect(() => {
    if (!cacheKey || !event) {
      return undefined;
    }

    return () => {
      window.localStorage.removeItem(cacheKey);
    };
  }, [cacheKey, event]);

  function handleClose() {
    if (cacheKey) {
      window.localStorage.removeItem(cacheKey);
    }

    if (window.opener) {
      window.close();
      return;
    }

    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    navigate('/events');
  }

  function handlePrint() {
    window.focus();
    window.print();
  }

  if (loading) {
    return (
      <section className="viewer-page">
        <header className="viewer-toolbar">
          <div>
            <p className="viewer-eyebrow">Event listing</p>
            <h1>Loading event</h1>
          </div>
        </header>
      </section>
    );
  }

  if (error || !event || !isEventVisible(event)) {
    return (
      <section className="viewer-page">
        <header className="viewer-toolbar">
          <div>
            <p className="viewer-eyebrow">Event listing</p>
            <h1>Event unavailable</h1>
          </div>
        </header>
        <p className="form-error">{error || 'This event is not currently available.'}</p>
        <Link className="button-link" to="/events">
          Back to events
        </Link>
      </section>
    );
  }

  const thumbnailUrl = event.imageUrl || (Array.isArray(event.imageUrls) ? event.imageUrls.find(Boolean) || '' : '');

  return (
    <section className="viewer-page event-print-page">
      <div className="viewer-toolbar">
        <div>
          <p className="viewer-eyebrow">Event listing</p>
          <h1>{event.title}</h1>
        </div>
        <div className="viewer-actions">
          <button className="button-link secondary-action" type="button" onClick={handlePrint}>
            Print
          </button>
          <button className="button-link" type="button" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
      <article className="public-event-card public-event-card--print">
        <div className="card-kicker">
          <span className="event-type-pill">{event.eventType || 'Other'}</span>
          <strong>{event.registrationOpen ? 'Registration open' : 'Registration closed'}</strong>
        </div>
        <div className="public-event-card-main">
          <h2>{event.title}</h2>
          {event.description ? <p>{event.description}</p> : null}
          <dl>
            <div className="event-card-date">
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
              <dd>{event.location || 'To be announced'}</dd>
            </div>
            <div>
              <dt>Presenter</dt>
              <dd>{event.presenter || 'To be announced'}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>{event.isPaid ? formatCurrency(event.cost) : 'No Charge'}</dd>
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
      </article>
    </section>
  );
}

function readCachedEvent(cacheKey) {
  if (!cacheKey) {
    return null;
  }

  try {
    const cachedEvent = window.localStorage.getItem(cacheKey);
    return cachedEvent ? JSON.parse(cachedEvent) : null;
  } catch {
    return null;
  }
}

export default EventListingPrintPage;
