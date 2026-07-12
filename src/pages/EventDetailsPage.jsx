import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
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
  const navigate = useNavigate();
  const supplyListFrameRef = useRef(null);
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const openSupplyListOnLoad = useMemo(
    () => new URLSearchParams(location.search).get('view') === 'supply-list',
    [location.search]
  );
  const isPopupMode = useMemo(
    () => new URLSearchParams(location.search).get('popup') === 'supply-list',
    [location.search]
  );
  const supplyListInlineUrl = useMemo(() => buildSupplyListProxyUrl(event, 'inline'), [event]);

  function openSupplyListPopup() {
    const route = `/events/${eventId}?view=supply-list&popup=supply-list`;
    const popup = window.open(route, 'vq-supply-list', 'popup,width=1100,height=900');

    if (popup) {
      popup.focus();
      return;
    }

    window.location.assign(route);
  }

  function handleCloseSupplyList() {
    if (window.opener) {
      window.close();
      return;
    }

    navigate(`/events/${eventId}`);
  }

  async function handlePrintSupplyList() {
    const printFrame = document.createElement('iframe');
    printFrame.className = 'print-helper-frame';
    printFrame.src = supplyListInlineUrl;
    printFrame.onload = () => {
      const frameWindow = printFrame.contentWindow;

      if (frameWindow) {
        frameWindow.focus();
        window.setTimeout(() => frameWindow.print(), 200);
      }

      window.setTimeout(() => printFrame.remove(), 5000);
    };

    document.body.appendChild(printFrame);
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
      <section className={isPopupMode ? 'popup-page' : ''}>
        <div className="supply-list-view">
          <div className="supply-list-view-header">
            <h2>{event.supplyListTitle || event.supplyListFileName || 'Supply list'}</h2>
            <div className="supply-list-view-actions">
              <button className="button-link secondary-action" type="button" onClick={handlePrintSupplyList}>
                Print
              </button>
              <button className="text-button" type="button" onClick={handleCloseSupplyList}>
                Close
              </button>
            </div>
          </div>
          <iframe
            ref={supplyListFrameRef}
            className="supply-list-view-frame"
            src={supplyListInlineUrl}
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
            <button
              className="text-button"
              type="button"
              onClick={openSupplyListPopup}
            >
              View and print {event.supplyListTitle || event.supplyListFileName || 'supply list'}
            </button>
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

function buildSupplyListProxyUrl(event, disposition) {
  if (!event?.supplyListUrl) {
    return '';
  }

  const params = new URLSearchParams({
    disposition,
    filename: event.supplyListFileName || `${event.supplyListTitle || 'supply-list'}.pdf`,
    url: event.supplyListUrl
  });

  return `/api/file-proxy?${params.toString()}`;
}

export default EventDetailsPage;
