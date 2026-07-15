import { getFirestore } from 'firebase-admin/firestore';
import { initializeAdminApp } from './_lib/public-event-feed.js';

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).send('Method not allowed.');
    return;
  }

  try {
    const eventId = getQueryValue(request.query.eventId);

    if (!eventId) {
      response.status(400).send(buildMessageHtml('Supply list unavailable', 'The event was missing.'));
      return;
    }

    initializeAdminApp();

    const db = getFirestore();
    const eventSnapshot = await db.collection('events').doc(eventId).get();

    if (!eventSnapshot.exists) {
      response.status(404).send(buildMessageHtml('Supply list unavailable', 'This event could not be found.'));
      return;
    }

    const event = { id: eventSnapshot.id, ...eventSnapshot.data() };

    if (!isPublicEvent(event) || !event.supplyListUrl) {
      response
        .status(404)
        .send(buildMessageHtml('Supply list unavailable', 'This document is not currently available.'));
      return;
    }

    const origin = getRequestOrigin(request);
    const fileName = event.supplyListFileName || `${event.supplyListTitle || 'supply-list'}.pdf`;
    const title = event.supplyListTitle || event.supplyListFileName || event.title || 'Supply List';
    const inlineUrl = buildFileProxyUrl(origin, event.supplyListUrl, fileName, 'inline');
    const attachmentUrl = buildFileProxyUrl(origin, event.supplyListUrl, fileName, 'attachment');

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'private, max-age=0, no-cache, no-store, must-revalidate');
    response.status(200).send(buildViewerHtml({ attachmentUrl, fileName, inlineUrl, title }));
  } catch (error) {
    response
      .status(500)
      .send(buildMessageHtml('Supply list unavailable', error.message || 'The document could not be loaded.'));
  }
}

function buildViewerHtml({ attachmentUrl, fileName, inlineUrl, title }) {
  const pageData = JSON.stringify({ attachmentUrl, fileName, inlineUrl, title }).replace(
    /</g,
    '\\u003c'
  );

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>${escapeHtml(title)}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        background: #f7f2eb;
        color: #2d241f;
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 28px clamp(18px, 5vw, 72px);
      }
      .toolbar {
        align-items: start;
        display: flex;
        flex-wrap: wrap;
        gap: 16px;
        justify-content: space-between;
        margin-bottom: 20px;
      }
      .eyebrow {
        color: #9a4d2f;
        font-size: 0.8rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        margin: 0 0 6px;
        text-transform: uppercase;
      }
      h1 {
        font-size: 1.65rem;
        line-height: 1.15;
        margin: 0;
      }
      .actions {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
      }
      .button {
        appearance: none;
        background: #2f5e4e;
        border: 1px solid #2f5e4e;
        border-radius: 6px;
        color: #fff;
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-weight: 700;
        line-height: 1;
        padding: 11px 16px;
        text-decoration: none;
      }
      .button.secondary {
        background: #fff;
        border-color: #cdbfb1;
        color: #2d241f;
      }
      .message {
        background: #fff;
        border: 1px solid #ded5ca;
        border-radius: 8px;
        margin-bottom: 18px;
        padding: 14px 16px;
      }
      .preview {
        display: grid;
        gap: 18px;
        justify-items: start;
      }
      .page {
        background: #fff;
        border: 1px solid #ddd2c6;
        border-radius: 8px;
        box-shadow: 0 8px 22px rgba(63, 45, 30, 0.12);
        max-width: 100%;
        overflow: auto;
        padding: 12px;
      }
      canvas {
        display: block;
        height: auto;
        max-width: 100%;
      }
      @media print {
        body {
          background: #fff;
          padding: 0;
        }
        .toolbar,
        .message {
          display: none;
        }
        .preview {
          gap: 0;
        }
        .page {
          border: 0;
          border-radius: 0;
          box-shadow: none;
          break-after: page;
          overflow: visible;
          padding: 0;
        }
      }
    </style>
  </head>
  <body>
    <header class="toolbar">
      <div>
        <p class="eyebrow">Supply List</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="actions">
        <a class="button secondary" id="save-button" href="${escapeAttribute(
          attachmentUrl
        )}" download="${escapeAttribute(fileName)}">Save</a>
        <button class="button secondary" id="print-button" type="button">Print</button>
        <a class="button secondary" href="${escapeAttribute(attachmentUrl)}">Direct Download</a>
        <button class="button" id="close-button" type="button">Close</button>
      </div>
    </header>
    <div class="message" id="message">Loading supply list preview...</div>
    <main class="preview" id="preview" aria-label="Supply list preview"></main>
    <script type="module">
      import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/pdf.mjs';

      pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.1.200/build/pdf.worker.mjs';

      const pageData = ${pageData};
      const message = document.getElementById('message');
      const preview = document.getElementById('preview');
      const printButton = document.getElementById('print-button');
      const closeButton = document.getElementById('close-button');

      closeButton.addEventListener('click', () => {
        if (window.history.length > 1) {
          window.history.back();
          return;
        }

        window.close();
      });

      printButton.addEventListener('click', () => {
        window.focus();
        window.print();
      });

      try {
        const response = await fetch(pageData.inlineUrl, {
          headers: {
            Accept: 'application/pdf'
          }
        });

        if (!response.ok) {
          throw new Error('The supply list could not be loaded.');
        }

        const data = await response.arrayBuffer();
        const pdfDocument = await pdfjsLib.getDocument({ data }).promise;

        preview.replaceChildren();

        for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
          const page = await pdfDocument.getPage(pageNumber);
          const viewport = page.getViewport({ scale: getPreviewScale() });
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          const wrapper = document.createElement('div');

          canvas.height = viewport.height;
          canvas.width = viewport.width;
          wrapper.className = 'page';
          wrapper.appendChild(canvas);
          preview.appendChild(wrapper);

          await page.render({
            canvasContext: context,
            viewport
          }).promise;
        }

        message.textContent = 'Supply list ready.';
      } catch (error) {
        message.innerHTML = '<strong>Preview unavailable.</strong> Use Save or Direct Download to download the PDF file.';
      }

      function getPreviewScale() {
        return window.innerWidth < 720 ? 1 : 1.35;
      }
    </script>
  </body>
</html>`;
}

function buildMessageHtml(title, message) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      body {
        background: #f7f2eb;
        color: #2d241f;
        font-family: Arial, sans-serif;
        margin: 0;
        padding: 28px;
      }
      main {
        background: #fff;
        border: 1px solid #ded5ca;
        border-radius: 8px;
        margin: 0 auto;
        max-width: 680px;
        padding: 22px;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
    </main>
  </body>
</html>`;
}

function buildFileProxyUrl(origin, fileUrl, fileName, disposition = 'inline') {
  const params = new URLSearchParams({
    cv: '20260715-2',
    disposition,
    filename: fileName || 'supply-list.pdf',
    url: fileUrl
  });

  return `${origin}/api/file-proxy?${params.toString()}`;
}

function getQueryValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function getRequestOrigin(request) {
  const forwardedProto = request.headers['x-forwarded-proto'] || 'https';
  const forwardedHost = request.headers['x-forwarded-host'] || request.headers.host || '';
  return `${forwardedProto}://${forwardedHost}`;
}

function isPublicEvent(event) {
  if (event.status !== 'Published') {
    return false;
  }

  const now = Date.now();
  const visibleFrom = event.visibleFrom ? Date.parse(event.visibleFrom) : null;
  const visibleUntil = event.visibleUntil ? Date.parse(event.visibleUntil) : null;

  if (visibleFrom && visibleFrom > now) {
    return false;
  }

  if (visibleUntil && visibleUntil < now) {
    return false;
  }

  return true;
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
