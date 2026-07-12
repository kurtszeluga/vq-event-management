import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
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
  const location = useLocation();
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const openSupplyListOnLoad = useMemo(
    () => new URLSearchParams(location.search).get('view') === 'supply-list',
    [location.search]
  );

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

  if (openSupplyListOnLoad && event.supplyListUrl) {
    return (
      <section>
        <div className="supply-list-view">
          <div className="supply-list-view-header">
            <h2>{event.supplyListTitle || event.supplyListFileName || 'Supply list'}</h2>
            <div className="supply-list-view-actions">
              <a
                className="button-link secondary-action"
                href={event.supplyListUrl}
                rel="noreferrer"
                target="_blank"
              >
                Print
              </a>
              <Link className="text-button" to="/events">
                Close
              </Link>
            </div>
          </div>
          <iframe
            className="supply-list-view-frame"
            src={event.supplyListUrl}
            title={event.supplyListTitle || event.supplyListFileName || 'Supply list'}
          />
        </div>
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
            <Link
              className="text-button"
              to={`/events/${event.id}?view=supply-list`}
            >
              View and print {event.supplyListTitle || event.supplyListFileName || 'supply list'}
            </Link>
          ) : null}
          {!event.registrationOpen ? (
            <p className="form-error">Registration is not currently open.</p>
          ) : null}
          <div className="detail-actions">
            <button
              className="button-link button-reset"
              type="button"
              onClick={() => window.print()}
            >
              Print Event
            </button>
          </div>
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
