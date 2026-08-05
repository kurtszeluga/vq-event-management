import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import EventImageCarousel from '../components/EventImageCarousel.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { getEvent } from '../services/eventService.js';
import { subscribeToDirectorySettings } from '../services/configurationService.js';
import { subscribeToEventRegistrantNames } from '../services/eventRegistrantNames.js';
import { useAuth } from '../context/useAuth.js';
import { loadPublicRegistrationCounts } from '../services/registrationService.js';
import {
  formatCurrency,
  formatEventDateRange,
  formatRegistrationDateRange,
  formatTimeRange,
  getRegistrationEndDate,
  getRegistrationStartDate,
  isEventVisible
} from '../utils/eventFormat.js';
import {
  getExternalRegistrationUrl,
  isRegistrationWindowOpen
} from '../../shared/registrationWindow.js';
import { getRegistrationAvailability } from '../utils/registrationAvailability.js';
import { openManagedPopup } from '../utils/popupWindow.js';
import { listEventDocuments } from '../../shared/eventDocuments.js';

function EventDetailsPage() {
  const navigate = useNavigate();
  const { eventId } = useParams();
  const [searchParams] = useSearchParams();
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [registrationCounts, setRegistrationCounts] = useState({});
  const { userProfile } = useAuth();
  const [registrantNames, setRegistrantNames] = useState([]);
  const [showRegistrantNames, setShowRegistrantNames] = useState(false);
  // Active membership, the same bar the member directory uses and the same
  // one isActiveMember() enforces in the rules - the read is refused for
  // anyone else, so asking is pointless as well as wrong.
  const canSeeRegistrants = userProfile?.status === 'Active'
    && userProfile?.membershipStatus === 'Active';
  const registrationStartDate = getRegistrationStartDate(event);
  const registrationEndDate = getRegistrationEndDate(event);

  function openDocumentPopup(eventDocument, clickEvent) {
    if (!eventDocument) {
      return;
    }

    openManagedPopup(
      `/events/${eventId}/${eventDocument.kind}`,
      `vq-${eventDocument.kind}`,
      'popup,width=1100,height=900',
      clickEvent.currentTarget
    );
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

    function refreshCounts() {
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
    }

    refreshCounts();
    const intervalId = window.setInterval(refreshCounts, 15000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [event?.id]);

  useEffect(() => {
    if (!canSeeRegistrants) {
      setShowRegistrantNames(false);
      return undefined;
    }

    return subscribeToDirectorySettings(
      (settings) => setShowRegistrantNames(Boolean(settings.showEventRegistrantNames)),
      () => setShowRegistrantNames(false)
    );
  }, [canSeeRegistrants]);

  useEffect(() => {
    if (!event?.id || !canSeeRegistrants || !showRegistrantNames) {
      setRegistrantNames([]);
      return undefined;
    }

    return subscribeToEventRegistrantNames(
      event.id,
      setRegistrantNames,
      () => setRegistrantNames([])
    );
  }, [event?.id, canSeeRegistrants, showRegistrantNames]);

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
  const externalRegistrationUrl = getExternalRegistrationUrl(event);
  const alreadyRegisteredView = searchParams.get('registered') === '1';

  return (
    <section>
      <PageHeader
        breadcrumb={[
          { label: 'Programs & Activities', to: '/events' },
          { label: event.title || event.eventType || 'Event' }
        ]}
        eyebrow={event.eventType}
        title={event.title}
        description={event.description}
      />
      <div className="event-detail-layout">
        <div className="detail-panel">
          <dl>
            {event.eventType !== 'Challenges' ? (
              <>
                <div>
                  <dt>{event.endDate && event.endDate !== event.date ? 'Dates' : 'Date'}</dt>
                  <dd>{formatEventDateRange(event)}</dd>
                </div>
                <div>
                  <dt>Time</dt>
                  <dd>{formatTimeRange(event.startTime, event.endTime)}</dd>
                </div>
              </>
            ) : null}
            {registrationStartDate || registrationEndDate ? (
              <div>
                <dt>Registration Open/Closes</dt>
                <dd>{formatRegistrationDateRange(event)}</dd>
              </div>
            ) : null}
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
                  ? `${formatCurrency(event.cost)}${Number(event.serviceFee || 0) > 0 ? ` plus ${formatCurrency(event.serviceFee)} service fee` : ''}${event.cashCheckOnly ? ' (cash/check only)' : ''}`
                  : 'No Charge'}
              </dd>
            </div>
            <div>
              <dt>Availability</dt>
              <dd>{availability.label}</dd>
            </div>
          </dl>
          {canSeeRegistrants && showRegistrantNames ? (
            <div className="event-registrant-panel">
              <strong>Who Is Registered</strong>
              {registrantNames.length ? (
                <ul className="event-registrant-names">
                  {registrantNames.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              ) : (
                <p className="form-help">Nobody is registered yet.</p>
              )}
            </div>
          ) : null}
          {listEventDocuments(event).map((eventDocument) => (
            <button
              className="text-button"
              key={eventDocument.kind}
              type="button"
              onClick={(clickEvent) => openDocumentPopup(eventDocument, clickEvent)}
            >
              View, print, or save {eventDocument.title}
            </button>
          ))}
          {!externalRegistrationUrl && !isRegistrationWindowOpen(event) ? (
            <p className="form-error">Registration is not currently open.</p>
          ) : null}
          <div className="detail-actions">
            {alreadyRegisteredView ? (
              <button
                className="button-link button-reset"
                type="button"
                onClick={() => navigate('/my-registrations')}
              >
                Return To My Registrations
              </button>
            ) : null}
            {externalRegistrationUrl && !alreadyRegisteredView ? (
              // rel is not optional: the URL is admin-entered and points
              // off-site, so the opened page must not get a handle on this one.
              <a
                className="button-link"
                href={externalRegistrationUrl}
                rel="noopener noreferrer"
                target="_blank"
              >
                Register
              </a>
            ) : null}
            {!externalRegistrationUrl && isRegistrationWindowOpen(event) && !alreadyRegisteredView ? (
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
          <EventImageCarousel
            altText={`${event.title} image`}
            eventType={event.eventType}
            imageUrls={event.imageUrls}
          />
        </div>
      </div>
    </section>
  );
}

export default EventDetailsPage;
