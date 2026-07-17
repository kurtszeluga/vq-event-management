import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { getEvent } from '../services/eventService.js';
import { loadPublicRegistrationCounts } from '../services/registrationService.js';
import {
  formatCurrency,
  formatEventDate,
  formatTimeRange,
  isEventVisible
} from '../utils/eventFormat.js';
import { getRegistrationAvailability } from '../utils/registrationAvailability.js';

function EventDetailsPage() {
  const { eventId } = useParams();
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [registrationCounts, setRegistrationCounts] = useState({});

  function openSupplyListPopup() {
    if (!event?.supplyListUrl) {
      return;
    }

    window.open(`/events/${eventId}/supply-list`, 'vq-supply-list', 'popup,width=1100,height=900');
  }

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

  useEffect(() => {
    let active = true;

    if (!event?.id) {
      setRegistrationCounts({});
      return undefined;
    }

    loadPublicRegistrationCounts([event.id])
      .then((counts) => {
        if (active) {
          setRegistrationCounts(counts[event.id] || {});
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
  }, [event?.id]);

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

  const availability = getRegistrationAvailability(event, registrationCounts);

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
                {event.isPaid
                  ? `${formatCurrency(event.cost)} plus ${formatCurrency(event.serviceFee)} service fee`
                  : 'No Charge'}
              </dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>{availability.label}</dd>
            </div>
          </dl>
          {event.supplyListUrl ? (
            <button
              className="text-button"
              type="button"
              onClick={openSupplyListPopup}
            >
              View, print, or save {event.supplyListTitle || event.supplyListFileName || 'supply list'}
            </button>
          ) : null}
          {!event.registrationOpen ? (
            <p className="form-error">Registration is not currently open.</p>
          ) : null}
          <div className="detail-actions">
            {event.registrationOpen ? (
              <Link className="button-link" to={`/register?eventId=${event.id}`}>
                {availability.isFull ? 'Join Waitlist' : 'Register'}
              </Link>
            ) : null}
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
