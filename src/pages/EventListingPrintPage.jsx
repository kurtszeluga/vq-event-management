import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { getEvent } from '../services/eventService.js';
import {
  formatCurrency,
  formatEventDate,
  formatTimeRange,
  isEventVisible
} from '../utils/eventFormat.js';

function EventListingPrintPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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
  }, [eventId]);

  function handleClose() {
    if (window.opener) {
      window.close();
      return;
    }

    navigate(`/events/${eventId}`);
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
          {event.imageUrls?.[0] ? (
            <img alt={`${event.title} thumbnail`} src={event.imageUrls[0]} />
          ) : (
            <div className="image-placeholder" aria-label="No image uploaded" />
          )}
        </div>
      </article>
    </section>
  );
}

export default EventListingPrintPage;
