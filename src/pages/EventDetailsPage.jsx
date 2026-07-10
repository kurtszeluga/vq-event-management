import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { getEvent } from '../services/eventService.js';
import {
  formatCurrency,
  formatEventDate,
  formatTimeRange,
  isEventVisible
} from '../utils/eventFormat.js';

function EventDetailsPage() {
  const { eventId } = useParams();
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

  if (loading) {
    return (
      <section>
        <PageHeader
          eyebrow="Event details"
          title="Loading event"
          description="Retrieving event information."
        />
      </section>
    );
  }

  if (error || !event || !isEventVisible(event)) {
    return (
      <section>
        <PageHeader
          eyebrow="Event details"
          title="Event unavailable"
          description={error || 'This event is not currently available.'}
        />
        <Link className="button-link" to="/events">
          Back to events
        </Link>
      </section>
    );
  }

  return (
    <section>
      <PageHeader
        eyebrow={event.eventType}
        title={event.title}
        description={event.description}
      />
      <div className="event-detail-layout">
        <div className="detail-panel">
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
              <dt>Presenter/Instructor</dt>
              <dd>{event.presenter || 'To be announced'}</dd>
            </div>
            <div>
              <dt>Cost</dt>
              <dd>
                {event.isPaid ? formatCurrency(event.cost) : 'Free'} plus{' '}
                {formatCurrency(event.serviceFee)} service fee
              </dd>
            </div>
          </dl>
          {event.supplyListUrl ? (
            <a className="text-button" href={event.supplyListUrl}>
              {event.supplyListTitle || event.supplyListFileName || 'Supply list PDF'}
            </a>
          ) : null}
          {event.registrationOpen ? (
            <Link className="button-link" to="/register">
              Continue to registration
            </Link>
          ) : (
            <p className="form-error">Registration is not currently open.</p>
          )}
        </div>
        <div className="event-image-grid">
          {event.imageUrls?.[0] ? (
            <img alt={`${event.title} image`} src={event.imageUrls[0]} />
          ) : (
            <div className="image-placeholder" />
          )}
        </div>
      </div>
    </section>
  );
}

export default EventDetailsPage;
