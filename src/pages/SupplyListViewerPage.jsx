import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { getEvent } from '../services/eventService.js';
import { isEventVisible } from '../utils/eventFormat.js';

function SupplyListViewerPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const pdfFrameRef = useRef(null);
  const printFrameRef = useRef(null);
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pdfUrl, setPdfUrl] = useState('');

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
    if (!event?.supplyListUrl) {
      setPdfUrl('');
      return undefined;
    }

    let active = true;
    let objectUrl = '';

    async function loadPdf() {
      try {
        const response = await fetch(event.supplyListUrl);

        if (!response.ok) {
          throw new Error('Unable to load the supply list.');
        }

        const blob = await response.blob();
        objectUrl = window.URL.createObjectURL(blob);

        if (active) {
          setPdfUrl(objectUrl);
        } else {
          window.URL.revokeObjectURL(objectUrl);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError.message);
          setPdfUrl('');
        }
      }
    }

    loadPdf();

    return () => {
      active = false;

      if (objectUrl) {
        window.URL.revokeObjectURL(objectUrl);
      }
    };
  }, [event?.supplyListUrl]);

  function handleClose() {
    if (window.opener) {
      window.close();
      return;
    }

    navigate(`/events/${eventId}`);
  }

  function handlePrint() {
    if (!pdfUrl) {
      return;
    }

    const printFrame = printFrameRef.current || document.createElement('iframe');
    printFrameRef.current = printFrame;
    printFrame.className = 'print-helper-frame';
    printFrame.src = pdfUrl;
    printFrame.onload = () => {
      const frameWindow = printFrame.contentWindow;

      if (frameWindow) {
        frameWindow.focus();
        window.setTimeout(() => frameWindow.print(), 250);
      }
    };

    if (!printFrame.isConnected) {
      document.body.appendChild(printFrame);
    }
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

  if (event?.supplyListUrl && !pdfUrl) {
    return (
      <section className="viewer-page">
        <PageHeader
          eyebrow="Supply list"
          title="Loading PDF"
          description="Preparing the document for viewing and printing."
        />
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
            href={pdfUrl}
            download={event.supplyListFileName || `${event.supplyListTitle || 'supply-list'}.pdf`}
          >
            Save
          </a>
          <button className="button-link secondary-action" type="button" onClick={handlePrint}>
            Print
          </button>
          <button className="button-link" type="button" onClick={handleClose}>
            Close
          </button>
        </div>
      </div>
      <iframe
        ref={pdfFrameRef}
        className="viewer-frame"
        src={pdfUrl}
        title={event.supplyListTitle || event.supplyListFileName || 'Supply list'}
      />
    </section>
  );
}

export default SupplyListViewerPage;
