import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { getEvent } from '../services/eventService.js';
import { isEventVisible } from '../utils/eventFormat.js';

function SupplyListViewerPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const pdfFrameRef = useRef(null);
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const inlineProxyUrl = buildProxyUrl(event, 'inline');
  const attachmentProxyUrl = buildProxyUrl(event, 'attachment');
  const canPreviewPdf = canBrowserPreviewPdf();

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
    const frameWindow = pdfFrameRef.current?.contentWindow;

    if (frameWindow) {
      frameWindow.focus();
      window.setTimeout(() => {
        frameWindow.print();
      }, 150);
      return;
    }

    window.focus();
    window.setTimeout(() => {
      window.print();
    }, 150);
  }

  if (loading) {
    return (
      <section className="viewer-page">
        <PageHeader eyebrow="Supply list" title="Loading supply list" description="Preparing the document." />
      </section>
    );
  }

  if (error || !event || !isEventVisible(event) || !event.supplyListUrl) {
    return (
      <section className="viewer-page">
        <PageHeader
          eyebrow="Supply list"
          title="Supply list unavailable"
          description={error || 'This document is not currently available.'}
        />
        <Link className="button-link" to={`/events/${eventId}`}>
          Return to event
        </Link>
      </section>
    );
  }

  return (
    <section className="viewer-page">
      <div className="viewer-toolbar">
        <div>
          <p className="viewer-eyebrow">Supply List</p>
          <h1>{event.supplyListTitle || event.supplyListFileName || event.title}</h1>
        </div>
        <div className="viewer-actions">
          <a
            className="button-link secondary-action"
            href={attachmentProxyUrl}
            download={event.supplyListFileName || `${event.supplyListTitle || 'supply-list'}.pdf`}
          >
            Save
          </a>
          {canPreviewPdf ? (
            <a className="button-link secondary-action" href={inlineProxyUrl} target="_blank" rel="noopener noreferrer">
              Open PDF
            </a>
          ) : null}
          {canPreviewPdf ? (
            <button className="button-link secondary-action" type="button" onClick={handlePrint}>
              Print
            </button>
          ) : null}
          <button className="button-link" type="button" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
      {canPreviewPdf ? (
        <iframe
          ref={pdfFrameRef}
          className="viewer-frame"
          src={inlineProxyUrl}
          title={event.supplyListTitle || event.supplyListFileName || 'Supply list'}
        />
      ) : (
        <div className="viewer-download-panel">
          <h2>Supply List Ready</h2>
          <p>
            This browser may show a blank preview for PDFs opened from the Village Quilters site.
            Use Save Supply List below to download it, then open it from your Downloads folder to view or print.
          </p>
          <div className="viewer-actions">
            <a
              className="button-link"
              href={attachmentProxyUrl}
              download={event.supplyListFileName || `${event.supplyListTitle || 'supply-list'}.pdf`}
            >
              Save Supply List
            </a>
          </div>
        </div>
      )}
    </section>
  );
}

function canBrowserPreviewPdf() {
  if (typeof navigator === 'undefined') {
    return true;
  }

  return navigator.userAgent.toLowerCase().includes('firefox');
}

function buildProxyUrl(event, disposition) {
  if (!event?.supplyListUrl) {
    return '';
  }

  const params = new URLSearchParams({
    cv: '20260714-2',
    disposition,
    filename: event.supplyListFileName || `${event.supplyListTitle || 'supply-list'}.pdf`,
    url: event.supplyListUrl
  });

  return `/api/file-proxy?${params.toString()}`;
}

export default SupplyListViewerPage;
