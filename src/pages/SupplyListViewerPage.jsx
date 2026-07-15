import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url';
import PageHeader from '../components/PageHeader.jsx';
import { getEvent } from '../services/eventService.js';
import { isEventVisible } from '../utils/eventFormat.js';

function SupplyListViewerPage() {
  const { eventId } = useParams();
  const navigate = useNavigate();
  const previewRef = useRef(null);
  const objectUrlRef = useRef('');
  const [downloadUrl, setDownloadUrl] = useState('');
  const [event, setEvent] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [previewError, setPreviewError] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
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

      if (pdfDocument) {
        pdfDocument.destroy();
      }
    };
  }, [inlineProxyUrl]);

  useEffect(() => () => {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
    }
  }, []);

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
    const canvases = Array.from(previewRef.current?.querySelectorAll('canvas') || []);

    if (!canvases.length) {
      window.focus();
      window.print();
      return;
    }

    const printWindow = window.open('', 'vq-supply-list-print', 'popup,width=1100,height=900');

    if (!printWindow) {
      window.focus();
      window.print();
      return;
    }

    const pages = canvases
      .map((canvas) => {
        const imageUrl = canvas.toDataURL('image/png');
        return `<div class="page"><img alt="Supply list page" src="${imageUrl}" /></div>`;
      })
      .join('');

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <title>${escapeHtml(fileName)}</title>
          <style>
            * { box-sizing: border-box; }
            body {
              background: #f7f2eb;
              color: #2d241f;
              font-family: Arial, sans-serif;
              margin: 0;
              padding: 24px;
            }
            .toolbar {
              align-items: center;
              display: flex;
              flex-wrap: wrap;
              gap: 12px;
              justify-content: flex-end;
              margin-bottom: 18px;
            }
            button {
              background: #2f5e4e;
              border: 0;
              border-radius: 6px;
              color: #fff;
              cursor: pointer;
              font: inherit;
              font-weight: 700;
              padding: 10px 16px;
            }
            button.secondary {
              background: #fff;
              border: 1px solid #cdbfb1;
              color: #2d241f;
            }
            .page {
              background: #fff;
              border: 1px solid #ddd2c6;
              box-shadow: 0 8px 22px rgba(63, 45, 30, 0.12);
              margin: 0 auto 18px;
              max-width: 980px;
              padding: 12px;
            }
            img {
              display: block;
              height: auto;
              width: 100%;
            }
            @media print {
              body {
                background: #fff;
                padding: 0;
              }
              .toolbar {
                display: none;
              }
              .page {
                border: 0;
                box-shadow: none;
                break-after: page;
                margin: 0;
                max-width: none;
                padding: 0;
              }
            }
          </style>
        </head>
        <body>
          <div class="toolbar">
            <button type="button" onclick="window.print()">Print</button>
            <button class="secondary" type="button" onclick="window.close()">Close</button>
          </div>
          ${pages}
          <script>
            window.addEventListener('load', function () {
              window.focus();
            });
          </script>
        </body>
      </html>`);
    printWindow.document.close();
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
            href={downloadUrl || attachmentProxyUrl}
            download={fileName}
          >
            Save
          </a>
          <button className="button-link secondary-action" type="button" onClick={handlePrint}>
            Print
          </button>
          <a className="button-link secondary-action" href={attachmentProxyUrl}>
            Direct Download
          </a>
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
          <p>Use Save or Direct Download above to download the PDF file.</p>
        </div>
      ) : null}
      <div ref={previewRef} className="viewer-pdf-preview" aria-label="Supply list preview" />
    </section>
  );
}

function getPreviewScale() {
  if (typeof window === 'undefined') {
    return 1.25;
  }

  return window.innerWidth < 720 ? 1 : 1.35;
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default SupplyListViewerPage;
