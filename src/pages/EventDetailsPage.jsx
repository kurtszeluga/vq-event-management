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
  const [supplyListObjectUrl, setSupplyListObjectUrl] = useState('');
  const openSupplyListOnLoad = useMemo(
    () => new URLSearchParams(location.search).get('view') === 'supply-list',
    [location.search]
  );
  const isPopupMode = useMemo(
    () => new URLSearchParams(location.search).get('popup') === 'supply-list',
    [location.search]
  );

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

  async function handleDownloadSupplyList() {
    const downloadName =
      event.supplyListFileName || `${event.supplyListTitle || 'supply-list'}.pdf`;
    const downloadUrl = supplyListObjectUrl || event.supplyListUrl;

    try {
      const link = document.createElement('a');

      if (!downloadUrl) {
        throw new Error('Unable to download the supply list.');
      }

      link.href = downloadUrl;
      link.download = downloadName;
      link.rel = 'noopener';
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch {
      window.open(event.supplyListUrl, '_blank', 'noopener');
    }
  }

  async function handlePrintSupplyList() {
    const frameWindow = supplyListFrameRef.current?.contentWindow;

    if (frameWindow) {
      frameWindow.focus();
      window.setTimeout(() => frameWindow.print(), 150);
      return;
    }

    window.print();
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
    if (!openSupplyListOnLoad || !event?.supplyListUrl) {
      setSupplyListObjectUrl('');
      return undefined;
    }

    let active = true;
    let objectUrl = '';

    async function loadSupplyList() {
      try {
        const response = await fetch(event.supplyListUrl);

        if (!response.ok) {
          throw new Error('Unable to load the supply list.');
        }

        const blob = await response.blob();
        objectUrl = window.URL.createObjectURL(blob);

        if (active) {
          setSupplyListObjectUrl(objectUrl);
        } else {
          window.URL.revokeObjectURL(objectUrl);
        }
      } catch {
        if (active) {
          setSupplyListObjectUrl('');
        }
      }
    }

    loadSupplyList();

    return () => {
      active = false;

      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [event?.supplyListUrl, openSupplyListOnLoad]);

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
              <button
                className="button-link secondary-action"
                type="button"
                onClick={handleDownloadSupplyList}
              >
                Save
              </button>
              <button
                className="button-link secondary-action"
                type="button"
                onClick={handlePrintSupplyList}
              >
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
            src={supplyListObjectUrl || event.supplyListUrl}
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

export default EventDetailsPage;
