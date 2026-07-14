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
    const popup = window.open('', 'vq-supply-list-print', 'popup,width=1100,height=900');

    if (!popup) {
      window.open(inlineProxyUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const safeTitle = escapeHtml(
      event?.supplyListTitle || event?.supplyListFileName || event?.title || 'Supply list'
    );
    const safePdfUrl = escapeHtml(inlineProxyUrl);

    popup.document.open();
    popup.document.write(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root {
        color: #1d2927;
        background: #f4efe8;
        font-family: Inter, Arial, sans-serif;
      }
      html, body {
        margin: 0;
        min-height: 100%;
      }
      body {
        padding: 24px 18px 32px;
      }
      .viewer-shell {
        margin: 0 auto;
        max-width: 1100px;
      }
      .viewer-topbar {
        align-items: center;
        display: flex;
        gap: 12px;
        justify-content: space-between;
        margin-bottom: 18px;
      }
      .viewer-title {
        font-size: 1.2rem;
        font-weight: 800;
        line-height: 1.2;
        margin: 0;
      }
      .viewer-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .viewer-button,
      .viewer-link {
        appearance: none;
        background: #225c56;
        border: 1px solid #225c56;
        border-radius: 999px;
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 10px 16px;
        text-decoration: none;
      }
      .viewer-link.secondary,
      .viewer-button.secondary {
        background: #ffffff;
        color: #225c56;
      }
      .viewer-frame-wrap {
        background: #ffffff;
        border: 1px solid #ded5ca;
        border-radius: 12px;
        box-shadow: 0 10px 24px rgba(29, 41, 39, 0.08);
        overflow: hidden;
      }
      .viewer-frame {
        border: 0;
        display: block;
        height: 78vh;
        width: 100%;
      }
    </style>
  </head>
  <body>
    <main class="viewer-shell">
      <div class="viewer-topbar">
        <h1 class="viewer-title">${safeTitle}</h1>
        <div class="viewer-actions">
          <a class="viewer-link secondary" href="${safePdfUrl}" target="_blank" rel="noopener noreferrer">Open PDF</a>
          <button class="viewer-button secondary" type="button" id="viewer-print">Print</button>
          <button class="viewer-button" type="button" onclick="window.close()">Close</button>
        </div>
      </div>
      <div class="viewer-frame-wrap">
        <iframe class="viewer-frame" id="viewer-frame" src="${safePdfUrl}" title="${safeTitle}"></iframe>
      </div>
    </main>
    <script>
      document.getElementById('viewer-print').addEventListener('click', function () {
        var frame = document.getElementById('viewer-frame');
        var frameWindow = frame && frame.contentWindow;

        if (!frameWindow) {
          window.open('${safePdfUrl}', '_blank', 'noopener,noreferrer');
          return;
        }

        try {
          frameWindow.focus();
          setTimeout(function () {
            try {
              frameWindow.print();
            } catch (error) {
              window.open('${safePdfUrl}', '_blank', 'noopener,noreferrer');
            }
          }, 250);
        } catch (error) {
          window.open('${safePdfUrl}', '_blank', 'noopener,noreferrer');
        }
      });
    </script>
  </body>
</html>`);
    popup.document.close();
    popup.focus();
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
        src={inlineProxyUrl}
        title={event.supplyListTitle || event.supplyListFileName || 'Supply list'}
      />
    </section>
  );
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

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export default SupplyListViewerPage;
