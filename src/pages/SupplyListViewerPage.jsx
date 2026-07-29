import { useEffect, useRef, useState, useCallback } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import PageHeader from '../components/PageHeader.jsx';
import { getEvent } from '../services/eventService.js';
import { isEventVisible } from '../utils/eventFormat.js';

function SupplyListViewerPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const headingRef = useRef(null);
  const previewRef = useRef(null);
  const printFrameRef = useRef(null);
  const objectUrlRef = useRef('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [printDocumentHtml, setPrintDocumentHtml] = useState('');
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
    let active = true;
    let pdfDocument = null;

    async function renderPdf() {
      if (!inlineProxyUrl || !previewRef.current) {
        return;
      }

      setPreviewLoading(true);
      setPreviewError('');
      previewRef.current.replaceChildren();

      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = '';
        setDownloadUrl('');
      }

      try {
        const response = await fetch(inlineProxyUrl, {
          headers: {
            Accept: 'application/pdf'
          }
        });

        if (!response.ok) {
          throw new Error('The supply list could not be loaded.');
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const nextObjectUrl = URL.createObjectURL(blob);

        if (!active) {
          URL.revokeObjectURL(nextObjectUrl);
          return;
        }

        objectUrlRef.current = nextObjectUrl;
        setDownloadUrl(nextObjectUrl);

        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        pdfDocument = await loadingTask.promise;

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          if (!active || !previewRef.current) {
            return;
          }

          const page = await pdfDocument.getPage(pageNumber);
          const viewport = page.getViewport({ scale: getPreviewScale() });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          const wrapper = document.createElement('div');

          canvas.height = viewport.height;
          canvas.width = viewport.width;
          canvas.className = 'viewer-pdf-canvas';
          wrapper.className = 'viewer-pdf-page';
          wrapper.appendChild(canvas);
          previewRef.current.appendChild(wrapper);

          await page.render({
            canvasContext: context,
            viewport
          }).promise;
        }
      } catch (renderError) {
        if (active) {
          setPreviewError(renderError.message || 'The supply list preview could not be shown.');
        }
      } finally {
        if (active) {
          setPreviewLoading(false);
        }
      }
    }

    renderPdf();

    return () => {
      active = false;

      if (pdfDocument && typeof pdfDocument.destroy === 'function') {
        pdfDocument.destroy();
      }
    };
  }, [inlineProxyUrl]);

  useEffect(() => () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
  }, []);

  useEffect(() => {
    if (loading || error || !event || !isEventVisible(event) || !event.supplyListUrl) {
      return;
    }

    headingRef.current?.focus();
  }, [error, event, loading]);

  // Safari finally prints reliably through this hidden same-page iframe.
  // Do not switch this back to window.print() on the live viewer, a popup,
  // or a PDF iframe print path without re-testing the full Safari workflow.
  useEffect(() => {
    if (!printDocumentHtml || !printFrameRef.current) {
      return;
    }

    const frame = printFrameRef.current;

    function handleLoad() {
      const frameWindow = frame.contentWindow;

      if (!frameWindow) {
        setPrintDocumentHtml('');
        return;
      }

      frameWindow.focus();
      window.setTimeout(() => {
        try {
          frameWindow.print();
        } finally {
          setPrintDocumentHtml('');
        }
      }, 150);
    }

    frame.addEventListener('load', handleLoad, { once: true });
    frame.srcdoc = printDocumentHtml;

    return () => {
      frame.removeEventListener('load', handleLoad);
    };
  }, [printDocumentHtml]);

  const handleClose = useCallback(() => {
    if (window.opener) {
      window.close();
      return;
    }

    navigate('/events');
  }, [navigate]);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleClose]);

  function handlePrint() {
    const pages = [...(previewRef.current?.querySelectorAll('.viewer-pdf-canvas') || [])]
      .map((canvas, index) => buildPrintPage(canvas, index))
      .filter(Boolean);

    if (!pages.length) {
      window.focus();
      window.print();
      return;
    }

    const title = event?.supplyListTitle || event?.supplyListFileName || event?.title || 'Supply List';
    setPrintDocumentHtml(buildSupplyListPrintHtml(title, pages));
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
          <h1 ref={headingRef} tabIndex={-1}>
            {event.supplyListTitle || event.supplyListFileName || event.title}
          </h1>
        </div>
        <div className="viewer-actions">
          <a
            className="button-link secondary-action"
            href={downloadUrl || attachmentProxyUrl}
            download={fileName}
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

      {previewLoading ? <p className="form-success">Loading supply list preview...</p> : null}
      {previewError ? (
        <div className="viewer-download-panel">
          <h2>Preview Unavailable</h2>
          <p>{previewError}</p>
          <p>Use Save above to download the PDF file.</p>
        </div>
      ) : null}
      <div ref={previewRef} className="viewer-pdf-preview" aria-label="Supply list preview" />
      <iframe
        aria-hidden="true"
        className="print-helper-frame"
        ref={printFrameRef}
        tabIndex={-1}
        title="Supply list print helper"
      />
    </section>
  );
}

function getPreviewScale() {
  if (typeof window === 'undefined') {
    return 1.25;
  }

  return window.innerWidth < 720 ? 1 : 1.35;
}

function buildPrintPage(canvas, index) {
  if (!(canvas instanceof HTMLCanvasElement)) {
    return null;
  }

  const dataUrl = canvas.toDataURL('image/png');

  if (!dataUrl) {
    return null;
  }

  return {
    alt: `Supply list page ${index + 1}`,
    dataUrl,
    height: canvas.height,
    width: canvas.width
  };
}

// Keep this print document self-contained and same-origin. Safari now opens
// the dialog from the hidden iframe that receives this HTML, and that exact
// behavior is intentional.
function buildSupplyListPrintHtml(title, pages) {
  const safeTitle = escapeHtml(title);
  const pageMarkup = pages
    .map((page) => `
      <figure class="print-page">
        <img
          alt="${escapeHtml(page.alt)}"
          height="${page.height}"
          src="${page.dataUrl}"
          width="${page.width}"
        />
      </figure>
    `)
    .join('');

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Print ${safeTitle}</title>
      <style>
        :root {
          color: #1d2927;
          background: #ffffff;
          font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        html, body {
          margin: 0;
          padding: 0;
        }
        body {
          padding: 24px 0;
        }
        .actions {
          display: flex;
          gap: 10px;
          justify-content: center;
          margin: 0 24px 20px;
        }
        button {
          appearance: none;
          background: #225c56;
          border: 1px solid #225c56;
          border-radius: 999px;
          color: #ffffff;
          cursor: pointer;
          font: inherit;
          font-weight: 700;
          padding: 10px 16px;
        }
        button.secondary {
          background: #ffffff;
          color: #225c56;
        }
        .print-shell {
          margin: 0 auto;
          max-width: 980px;
        }
        .print-page {
          margin: 0 0 18px;
          page-break-after: always;
        }
        .print-page:last-child {
          page-break-after: auto;
        }
        img {
          display: block;
          height: auto;
          max-width: 100%;
          width: 100%;
        }
        @page {
          margin: 0.5in;
        }
        @media print {
          body {
            padding: 0;
          }
          .actions {
            display: none;
          }
          .print-page {
            break-after: page;
            margin: 0;
          }
          .print-page:last-child {
            break-after: auto;
          }
        }
      </style>
    </head>
    <body onload="window.setTimeout(function () { window.print(); }, 150)">
      <div class="actions">
        <button type="button" onclick="window.print()">Print</button>
        <button type="button" class="secondary" onclick="window.close()">Close</button>
      </div>
      <main class="print-shell" aria-label="${safeTitle}">
        ${pageMarkup}
      </main>
    </body>
  </html>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
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
