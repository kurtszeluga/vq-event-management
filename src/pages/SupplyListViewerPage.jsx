import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { getEvent } from '../services/eventService.js';
import { isEventVisible } from '../utils/eventFormat.js';

function SupplyListViewerPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const frameRef = useRef(null);
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [viewerError, setViewerError] = useState('');
  const [viewerLoading, setViewerLoading] = useState(true);
  const inlineProxyUrl = buildProxyUrl(event, 'inline');
  const attachmentProxyUrl = buildProxyUrl(event, 'attachment');
  const fileName = event?.supplyListFileName || `${event?.supplyListTitle || 'supply-list'}.pdf`;

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
    setViewerLoading(Boolean(inlineProxyUrl));
    setViewerError('');
  }, [inlineProxyUrl]);

  function handleClose() {
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
    const frameWindow = frameRef.current?.contentWindow;

    if (frameWindow) {
      frameWindow.focus();
      window.setTimeout(() => {
        try {
          frameWindow.print();
        } catch {
          openInlinePdf();
        }
      }, 150);
      return;
    }

    openInlinePdf();
  }

  function openInlinePdf() {
    if (!inlineProxyUrl) {
      return;
    }

    const popup = window.open(inlineProxyUrl, '_blank', 'noopener,noreferrer');
    popup?.focus();
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
            download={fileName}
          >
            Save
          </a>
          <button
            className="button-link secondary-action"
            disabled={viewerLoading || !inlineProxyUrl}
            type="button"
            onClick={handlePrint}
          >
            Print
          </button>
          <button
            className="button-link button-reset secondary-action"
            type="button"
            onClick={openInlinePdf}
          >
            Open PDF
          </button>
          <a className="button-link secondary-action" href={attachmentProxyUrl}>
            Direct Download
          </a>
          <button className="button-link" type="button" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>

      {viewerLoading ? <p className="form-success">Loading PDF viewer...</p> : null}
      {viewerError ? (
        <div className="viewer-download-panel">
          <h2>Viewer Unavailable</h2>
          <p>{viewerError}</p>
          <p>Use Open PDF, Save, or Direct Download above to access the file.</p>
        </div>
      ) : (
        <iframe
          className="viewer-frame"
          ref={frameRef}
          src={inlineProxyUrl}
          title={event.supplyListTitle || event.supplyListFileName || event.title || 'Supply list'}
          onError={() => {
            setViewerLoading(false);
            setViewerError('The PDF viewer could not be loaded in this browser window.');
          }}
          onLoad={() => {
            setViewerLoading(false);
            setViewerError('');
          }}
        />
      )}
    </section>
  );
}

function buildProxyUrl(event, disposition) {
  if (!event?.supplyListUrl) {
    return '';
  }

  const params = new URLSearchParams({
    cv: '20260715-1',
    disposition,
    filename: event.supplyListFileName || `${event.supplyListTitle || 'supply-list'}.pdf`,
    url: event.supplyListUrl
  });

  return `/api/file-proxy?${params.toString()}`;
}

export default SupplyListViewerPage;
