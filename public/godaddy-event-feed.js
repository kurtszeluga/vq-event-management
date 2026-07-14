(function () {
  const DEFAULTS = {
    category: 'events',
    emptyMessage: 'No published listings are available right now.',
    limit: 0,
    mountSelector: '[data-vq-feed]',
    sourceUrl: '/api/public-events'
  };
  const DESCRIPTION_PREVIEW_LENGTH = 180;
  const STYLE_ID = 'vq-embed-feed-styles';

  function initFeed(container) {
    const config = {
      ...DEFAULTS,
      category: container.dataset.category || DEFAULTS.category,
      emptyMessage: container.dataset.emptyMessage || DEFAULTS.emptyMessage,
      limit: Number(container.dataset.limit || 0),
      sourceUrl: container.dataset.sourceUrl || DEFAULTS.sourceUrl
    };

    ensureStyles();
    renderShell(container);
    loadFeed(container, config);
  }

  async function loadFeed(container, config) {
    const root = container.querySelector('.vq-feed-root');

    try {
      root.innerHTML = '<div class="vq-feed-loading">Loading listings...</div>';
      const url = new URL(config.sourceUrl, window.location.href);
      url.searchParams.set('category', config.category);

      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error('Feed request failed.');
      }

      const payload = await response.json();
      const events = config.limit > 0 ? payload.events.slice(0, config.limit) : payload.events;
      renderFeed(container, payload, events, config);
    } catch (error) {
      root.innerHTML = '<div class="vq-feed-error">The event feed could not be loaded right now.</div>';
    }
  }

  function renderFeed(container, payload, events, config) {
    const root = container.querySelector('.vq-feed-root');

    if (!events.length) {
      root.innerHTML = `<div class="vq-feed-empty">${escapeHtml(config.emptyMessage)}</div>`;
      return;
    }

    const supportsFilters = payload.supportsTypeFilters;
    const filterMarkup = supportsFilters ? buildFilterMarkup(payload, events) : '';

    root.innerHTML = `
      ${filterMarkup}
      <div class="vq-feed-list">
        ${events.map((event) => buildCardMarkup(event, config)).join('')}
      </div>
    `;

    if (supportsFilters) {
      wireFilters(root);
    }

    wireDescriptionToggles(root);
    wireImageViewerLinks(root);
    wireSupplyListLinks(root, config);
    wireEventPrintLinks(root);
  }

  function buildFilterMarkup(payload, events) {
    const filters = getVisibleFilters(payload, events);

    if (!filters.length) {
      return '';
    }

    return `
      <div class="vq-feed-filters" aria-label="Event type filters">
        ${filters
          .map(
            (filter, index) =>
              `<button class="vq-feed-filter${index === 0 ? ' is-active' : ''}" data-filter="${escapeHtml(filter.value)}" type="button">${escapeHtml(filter.label)} (${filter.count})</button>`
          )
          .join('')}
      </div>
    `;
  }

  function getVisibleFilters(payload, events) {
    if (payload.category !== 'events') {
      return Object.keys(payload.typeCounts || {})
        .sort((left, right) => left.localeCompare(right))
        .map((type) => ({
          count: payload.typeCounts[type] || 0,
          label: type,
          value: type
        }));
    }

    const programsCount = events.filter((event) => isProgramType(event.eventType)).length;
    const workshopsCount = events.filter((event) => event.eventType === 'Workshop').length;

    return [
      { count: programsCount, label: 'Programs', value: 'Programs' },
      { count: workshopsCount, label: 'Workshops', value: 'Workshops' }
    ];
  }

  function buildCardMarkup(event, config) {
    const description = event.description || '';
    const longDescription = description.length > DESCRIPTION_PREVIEW_LENGTH;
    const preview = longDescription
      ? `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trim()}...`
      : description;
    const presenterLabel = event.presenter || event.contactName || event.ownerName || '';
    const cost = event.isPaid ? formatCurrency(event.cost) : 'Free';
    const thumbnail = event.imageUrl
      ? `<div class="vq-feed-thumb-stack"><a class="vq-feed-thumb-link" href="${escapeAttribute(event.imageUrl)}" data-image-viewer-src="${escapeAttribute(event.imageUrl)}" data-image-viewer-title="${escapeAttribute(event.title)}" aria-label="Open larger image for ${escapeHtml(event.title)}"><img alt="${escapeHtml(event.title)} thumbnail" class="vq-feed-thumb-image" src="${escapeAttribute(event.imageUrl)}" /></a><span class="vq-feed-thumb-hint">Click image for larger view</span></div>`
      : '<div class="vq-feed-thumb-placeholder" aria-hidden="true"></div>';
    const supplyListLink = event.supplyListUrl
      ? `<button class="vq-feed-secondary" type="button" data-supply-list-url="${escapeAttribute(event.supplyListUrl)}" data-supply-list-title="${escapeAttribute(event.supplyListTitle || 'Supply list')}" data-supply-list-file-name="${escapeAttribute(event.supplyListFileName || `${event.supplyListTitle || 'supply-list'}.pdf`)}">View and print ${escapeHtml(event.supplyListTitle || 'document')}</button>`
      : '';
    const registerLink = event.registerUrl
      ? `<a class="vq-feed-primary" href="${escapeAttribute(event.registerUrl)}" target="_blank" rel="noopener noreferrer">Register</a>`
      : '';
    const eventPrintPayload = escapeAttribute(JSON.stringify(event));

    return `
      <article class="vq-feed-card" data-event-type="${escapeAttribute(event.eventType)}">
        <div class="vq-feed-card-main">
          <div class="vq-feed-card-top">
            <div class="vq-feed-card-top-left">
              <div class="vq-feed-pill-row">
                <span class="vq-feed-type">${escapeHtml(event.eventType)}</span>
                <span class="vq-feed-status-pill ${event.registrationOpen ? 'is-open' : 'is-closed'}">${event.registrationOpen ? 'Registration Open' : 'Registration Closed'}</span>
              </div>
              <div class="vq-feed-title-block">
                <div class="vq-feed-date">${escapeHtml(formatEventDate(event.date))}</div>
                <h3>${escapeHtml(event.title)}</h3>
              </div>
              ${description ? `
                <div class="vq-feed-description">
                  <p data-role="preview">${escapeHtml(preview)}</p>
                  ${longDescription ? `<p class="is-hidden" data-role="full">${escapeHtml(description)}</p>` : ''}
                  ${longDescription ? '<button class="vq-feed-text-button" data-action="toggle-description" type="button">Show Full Description</button>' : ''}
                </div>
              ` : ''}
            </div>
            <div class="vq-feed-thumb">${thumbnail}</div>
          </div>
          <dl class="vq-feed-meta">
            <div><dt>Time</dt><dd>${escapeHtml(formatTimeRange(event.startTime, event.endTime))}</dd></div>
            ${presenterLabel ? `<div><dt>Presenter</dt><dd>${escapeHtml(presenterLabel)}</dd></div>` : ''}
            ${event.location ? `<div><dt>Location</dt><dd>${escapeHtml(event.location)}</dd></div>` : ''}
            <div><dt>Cost</dt><dd>${escapeHtml(cost)}</dd></div>
          </dl>
          <div class="vq-feed-actions">
            ${supplyListLink}
            <button class="vq-feed-secondary" type="button" data-event-print="${eventPrintPayload}">Print ${escapeHtml(event.eventType)}</button>
            <a class="vq-feed-secondary" href="${escapeAttribute(event.detailUrl)}" target="_blank" rel="noopener noreferrer">View Details</a>
            ${event.registrationOpen ? registerLink : ''}
          </div>
        </div>
      </article>
    `;
  }

  function wireFilters(root) {
    const buttons = Array.from(root.querySelectorAll('.vq-feed-filter'));
    const cards = Array.from(root.querySelectorAll('.vq-feed-card'));

    if (!buttons.length) {
      return;
    }

    applyFilter(buttons[0].dataset.filter || '', cards);

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const filterValue = button.dataset.filter || 'All';

        buttons.forEach((item) => item.classList.toggle('is-active', item === button));
        applyFilter(filterValue, cards);
      });
    });
  }

  function applyFilter(filterValue, cards) {
    cards.forEach((card) => {
      const eventType = card.dataset.eventType || '';
      const matches = filterValue === 'Programs'
        ? isProgramType(eventType)
        : filterValue === 'Workshops'
          ? eventType === 'Workshop'
          : eventType === filterValue;
      card.classList.toggle('is-hidden', !matches);
    });
  }

  function wireDescriptionToggles(root) {
    root.querySelectorAll('[data-action="toggle-description"]').forEach((button) => {
      button.addEventListener('click', () => {
        const descriptionBlock = button.closest('.vq-feed-description');
        const preview = descriptionBlock.querySelector('[data-role="preview"]');
        const full = descriptionBlock.querySelector('[data-role="full"]');
        const expanded = full && !full.classList.contains('is-hidden');

        if (!full || !preview) {
          return;
        }

        preview.classList.toggle('is-hidden', !expanded);
        full.classList.toggle('is-hidden', expanded);
        button.textContent = expanded ? 'Show Full Description' : 'Hide Description';
      });
    });
  }

  function renderShell(container) {
    container.innerHTML = '<div class="vq-feed-root"></div>';
  }

  function wireImageViewerLinks(root) {
    root.querySelectorAll('[data-image-viewer-src]').forEach((link) => {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        openImageViewer(link.dataset.imageViewerSrc || '', link.dataset.imageViewerTitle || 'Event image');
      });
    });
  }

  function wireSupplyListLinks(root, config) {
    root.querySelectorAll('[data-supply-list-url]').forEach((button) => {
      button.addEventListener('click', () => {
        openSupplyListPopup(
          button.dataset.supplyListUrl || '',
          button.dataset.supplyListTitle || 'Supply list',
          button.dataset.supplyListFileName || 'supply-list.pdf',
          config.sourceUrl
        );
      });
    });
  }

  function wireEventPrintLinks(root) {
    root.querySelectorAll('[data-event-print]').forEach((button) => {
      button.addEventListener('click', () => {
        try {
          openEventPrintPopup(JSON.parse(button.dataset.eventPrint || '{}'));
        } catch {
          return;
        }
      });
    });
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .vq-feed-root {
        color: #1d2927;
        font-family: Inter, Arial, sans-serif;
      }
      .vq-feed-loading,
      .vq-feed-empty,
      .vq-feed-error {
        background: #f7f4ef;
        border: 1px solid #ded5ca;
        border-radius: 8px;
        padding: 18px 20px;
      }
      .vq-feed-filters {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 0 0 18px;
      }
      .vq-feed-filter {
        appearance: none;
        background: #ffffff;
        border: 1px solid #c8d4d0;
        border-radius: 999px;
        color: #1d2927;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 10px 14px;
      }
      .vq-feed-filter.is-active {
        background: #225c56;
        border-color: #225c56;
        color: #ffffff;
      }
      .vq-feed-list {
        display: grid;
        gap: 18px;
      }
      .vq-feed-card {
        background: #ffffff;
        border: 1px solid #ded5ca;
        border-radius: 10px;
        box-shadow: 0 10px 24px rgba(29, 41, 39, 0.06);
        padding: 18px;
      }
      .vq-feed-card.is-hidden,
      .vq-feed-description .is-hidden {
        display: none;
      }
      .vq-feed-card-top {
        align-items: flex-start;
        display: flex;
        gap: 14px;
        justify-content: space-between;
      }
      .vq-feed-card-top-left {
        display: grid;
        gap: 6px;
        min-width: 0;
        flex: 1 1 auto;
      }
      .vq-feed-pill-row {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }
      .vq-feed-type {
        background: #e9f2ef;
        border: 1px solid #c6dad5;
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.82rem;
        font-weight: 800;
        padding: 6px 10px;
      }
      .vq-feed-status-pill {
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.82rem;
        font-weight: 800;
        padding: 6px 10px;
      }
      .vq-feed-status-pill.is-open {
        background: #e7f6ea;
        border: 1px solid #8bc79a;
        color: #1f6a31;
      }
      .vq-feed-status-pill.is-closed {
        background: #fff6d9;
        border: 1px solid #ddc66b;
        color: #876d14;
      }
      .vq-feed-title-block {
        display: grid;
        gap: 3px;
        min-width: 0;
      }
      .vq-feed-primary,
      .vq-feed-secondary {
        appearance: none;
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.95rem;
        font-weight: 700;
        padding: 9px 14px;
        text-decoration: none;
        white-space: nowrap;
      }
      button.vq-feed-primary,
      button.vq-feed-secondary {
        cursor: pointer;
        font-family: inherit;
      }
      .vq-feed-primary {
        background: #225c56;
        border: 1px solid #225c56;
        color: #ffffff;
      }
      .vq-feed-secondary {
        background: #ffffff;
        border: 1px solid #c8d4d0;
        color: #225c56;
      }
      .vq-feed-date {
        color: #9a4d2f;
        font-size: 1.48rem;
        font-weight: 800;
        line-height: 1.1;
        margin-bottom: 4px;
      }
      .vq-feed-card h3 {
        font-size: 1.4rem;
        line-height: 1.2;
        margin: 0;
      }
      .vq-feed-thumb {
        flex: 0 0 auto;
      }
      .vq-feed-thumb-stack {
        align-items: flex-start;
        display: grid;
        gap: 6px;
      }
      .vq-feed-thumb-link {
        border-radius: 8px;
        display: block;
        overflow: hidden;
      }
      .vq-feed-thumb-hint {
        color: #5a6b67;
        font-size: 0.78rem;
        font-weight: 600;
        line-height: 1.2;
      }
      .vq-feed-thumb-image,
      .vq-feed-thumb-placeholder {
        border-radius: 8px;
        display: block;
        height: 132px;
        object-fit: cover;
        width: 172px;
      }
      .vq-feed-thumb-placeholder {
        background: linear-gradient(135deg, #f6efe9, #ebe3da);
      }
      .vq-feed-description {
        margin-top: 8px;
        max-width: 100%;
      }
      .vq-feed-description p {
        line-height: 1.55;
        margin: 0;
        white-space: pre-wrap;
      }
      .vq-feed-text-button {
        appearance: none;
        background: none;
        border: 0;
        color: #225c56;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        margin-top: 8px;
        padding: 0;
      }
      .vq-feed-meta {
        display: grid;
        gap: 10px;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        margin: 12px 0 0;
      }
      .vq-feed-meta div {
        display: grid;
        gap: 4px;
      }
      .vq-feed-meta dt {
        color: #5a6b67;
        font-size: 0.82rem;
        font-weight: 700;
      }
      .vq-feed-meta dd {
        margin: 0;
      }
      .vq-feed-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
        justify-content: flex-start;
      }
      @media (max-width: 720px) {
        .vq-feed-card-top {
          flex-direction: column;
        }
        .vq-feed-thumb-image,
        .vq-feed-thumb-placeholder {
          width: 100%;
          max-width: 240px;
        }
      }
    `;

    document.head.appendChild(style);
  }

  function formatEventDate(value) {
    if (!value) {
      return 'Date TBD';
    }

    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
      const parts = value.split('-');
      return [parts[1], parts[2], parts[0]].join('/');
    }

    const parsed = new Date(value);

    if (!Number.isNaN(parsed.getTime())) {
      return new Intl.DateTimeFormat('en-US', {
        month: '2-digit',
        day: '2-digit',
        year: 'numeric'
      }).format(parsed);
    }

    return value;
  }

  function formatTimeRange(startTime, endTime) {
    if (!startTime || !endTime) {
      return 'Time TBD';
    }

    return `${formatClockTime(startTime)} - ${formatClockTime(endTime)}`;
  }

  function formatClockTime(value) {
    const parts = String(value || '').split(':');
    const hour = Number(parts[0] || 0);
    const minute = parts[1] || '00';
    const suffix = hour >= 12 ? 'p.m.' : 'a.m.';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${minute} ${suffix}`;
  }

  function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(Number(value || 0));
  }

  function isProgramType(eventType) {
    return eventType === 'Lecture'
      || eventType === 'Class (Half Day)'
      || eventType === 'Class (Full Day)';
  }

  function openSupplyListPopup(pdfUrl, title, fileName, sourceUrl) {
    if (!pdfUrl) {
      return;
    }

    const popup = window.open('', 'vq-supply-list', 'popup,width=1100,height=900');

    if (!popup) {
      window.open(pdfUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const html = buildSupplyListHtml(pdfUrl, title, fileName, sourceUrl);

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
  }

  function getSourceOrigin(sourceUrl) {
    try {
      return new URL(sourceUrl, window.location.href).origin;
    } catch {
      return window.location.origin;
    }
  }

  function buildSupplyListHtml(pdfUrl, title, fileName, sourceUrl) {
    const safeTitle = escapeHtml(title || 'Supply list');
    const safeFileName = escapeHtml(fileName || 'supply-list.pdf');
    const proxyOrigin = getSourceOrigin(sourceUrl);
    const inlineUrl = buildProxyUrl(proxyOrigin, pdfUrl, fileName, 'inline');
    const saveUrl = buildProxyUrl(proxyOrigin, pdfUrl, fileName, 'attachment');

    return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${safeTitle}</title>
      <style>
        :root {
          background: #f4efe8;
          color: #1d2927;
          font-family: Inter, Arial, sans-serif;
        }
        html,
        body {
          height: 100%;
          margin: 0;
        }
        body {
          display: flex;
          flex-direction: column;
        }
        .viewer-toolbar {
          align-items: center;
          background: #ffffff;
          border-bottom: 1px solid #ded5ca;
          display: flex;
          gap: 14px;
          justify-content: space-between;
          padding: 14px 18px;
        }
        .viewer-title {
          display: grid;
          gap: 2px;
          min-width: 0;
        }
        .viewer-title span {
          color: #9a4d2f;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        h1 {
          font-size: 20px;
          line-height: 1.2;
          margin: 0;
        }
        .viewer-actions {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 8px;
          justify-content: flex-end;
        }
        .viewer-button {
          appearance: none;
          background: #225c56;
          border: 1px solid #225c56;
          border-radius: 999px;
          color: #ffffff;
          cursor: pointer;
          display: inline-flex;
          font: inherit;
          font-weight: 700;
          padding: 9px 14px;
          text-decoration: none;
        }
        .viewer-button.secondary {
          background: #ffffff;
          color: #225c56;
        }
        .viewer-frame {
          background: #ffffff;
          border: 0;
          flex: 1 1 auto;
          width: 100%;
        }
        .viewer-help {
          background: #fff8dc;
          border-top: 1px solid #ddc66b;
          color: #5b4a10;
          font-size: 14px;
          padding: 8px 18px;
        }
        @media print {
          .viewer-toolbar,
          .viewer-help {
            display: none;
          }
        }
      </style>
    </head>
    <body>
      <header class="viewer-toolbar">
        <div class="viewer-title">
          <span>Supply List</span>
          <h1>${safeTitle}</h1>
        </div>
        <div class="viewer-actions">
          <a class="viewer-button secondary" href="${escapeAttribute(inlineUrl)}" target="_blank" rel="noopener noreferrer">Open PDF</a>
          <a class="viewer-button secondary" href="${escapeAttribute(saveUrl)}" download="${escapeAttribute(safeFileName)}">Save</a>
          <button class="viewer-button" type="button" onclick="triggerPrint()">Print</button>
          <button class="viewer-button secondary" type="button" onclick="window.close()">Close</button>
        </div>
      </header>
      <iframe class="viewer-frame" src="${escapeAttribute(inlineUrl)}" title="${safeTitle}"></iframe>
      <div class="viewer-help">If the PDF does not display, select Open PDF.</div>
      <script>
        function triggerPrint() {
          window.focus();
          window.setTimeout(function () {
            try {
              window.print();
            } catch (error) {}
          }, 100);
        }
      </script>
    </body>
  </html>`;
  }

  function buildProxyUrl(origin, pdfUrl, fileName, disposition) {
    const params = new URLSearchParams({
      cv: '20260714-9',
      disposition,
      filename: fileName || 'supply-list.pdf',
      url: pdfUrl
    });

    return `${origin}/api/file-proxy?${params.toString()}`;
  }

  function openEventPrintPopup(event) {
    if (!event?.id) {
      return;
    }

    const popup = window.open('', 'vq-event-print', 'popup,width=1100,height=900');

    if (!popup) {
      return;
    }

    const html = buildEventPrintHtml(event);

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
  }

  function buildEventPrintHtml(event) {
    const title = escapeHtml(event.title || 'Event');
    const eventType = escapeHtml(event.eventType || 'Other');
    const description = event.description ? `<p class="description">${escapeHtml(event.description)}</p>` : '';
    const date = escapeHtml(formatEventDate(event.date));
    const time = escapeHtml(formatTimeRange(event.startTime, event.endTime));
    const location = escapeHtml(event.location || 'To be announced');
    const presenter = escapeHtml(event.presenter || 'To be announced');
    const cost = escapeHtml(event.isPaid ? formatCurrency(event.cost) : 'Free');
    const registration = event.registrationOpen ? 'Registration open' : 'Registration closed';
    const imageBlock = event.imageUrl
      ? `<div class="image-wrap"><img alt="${title} thumbnail" src="${escapeAttribute(event.imageUrl)}" /></div>`
      : '<div class="image-wrap image-placeholder" aria-label="No image uploaded"></div>';

    return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Print ${title}</title>
      <style>
        :root {
          color: #1d2927;
          background: #ffffff;
          font-family: Inter, Arial, sans-serif;
        }
        html, body {
          margin: 0;
          padding: 0;
        }
        body {
          padding: 32px 28px 40px;
        }
        .page {
          margin: 0 auto;
          max-width: 760px;
        }
        .topbar {
          align-items: flex-start;
          display: flex;
          gap: 16px;
          justify-content: space-between;
          margin-bottom: 22px;
        }
        .eyebrow {
          color: #9a4d2f;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.08em;
          margin: 0 0 8px;
          text-transform: uppercase;
        }
        h1 {
          font-size: 28px;
          line-height: 1.15;
          margin: 0;
        }
        .meta {
          display: grid;
          gap: 12px;
          margin: 20px 0 0;
        }
        .meta-row {
          display: grid;
          grid-template-columns: 120px 1fr;
          gap: 12px;
        }
        .meta-label {
          font-weight: 800;
        }
        .pill {
          align-items: center;
          background: #e9f2ef;
          border: 1px solid #c6dad5;
          border-radius: 999px;
          display: inline-flex;
          font-size: 12px;
          font-weight: 800;
          padding: 6px 10px;
        }
        .image-wrap {
          border: 1px solid #ded5ca;
          border-radius: 8px;
          margin-top: 18px;
          overflow: hidden;
          width: 180px;
        }
        .image-wrap img {
          display: block;
          height: 180px;
          object-fit: cover;
          width: 100%;
        }
        .image-placeholder {
          background: linear-gradient(135deg, #f6efe9, #ebe3da);
          height: 180px;
        }
        .actions {
          display: inline-flex;
          gap: 8px;
          margin-top: 4px;
        }
        button {
          appearance: none;
          background: #225c56;
          border: 1px solid #225c56;
          border-radius: 8px;
          color: #fff;
          cursor: pointer;
          font: inherit;
          font-weight: 700;
          padding: 10px 14px;
        }
        button.secondary {
          background: #fff;
          color: #225c56;
        }
        .description {
          line-height: 1.55;
          margin: 16px 0 0;
          white-space: pre-wrap;
        }
        @media print {
          body {
            padding: 0;
          }
          .actions {
            display: none;
          }
        }
      </style>
    </head>
    <body onload="window.setTimeout(function () { triggerPrint(); }, 150)">
      <main class="page">
        <div class="topbar">
          <div>
            <p class="eyebrow">Event listing</p>
            <h1>${title}</h1>
          </div>
          <div class="actions">
            <button type="button" onclick="triggerPrint()">Print</button>
            <button type="button" class="secondary" onclick="window.close()">Close</button>
          </div>
        </div>
        <div class="pill">${eventType}</div>
        <div class="meta">
          <div class="meta-row"><div class="meta-label">Status</div><div>${registration}</div></div>
          <div class="meta-row"><div class="meta-label">Date</div><div>${date}</div></div>
          <div class="meta-row"><div class="meta-label">Time</div><div>${time}</div></div>
          <div class="meta-row"><div class="meta-label">Location</div><div>${location}</div></div>
          <div class="meta-row"><div class="meta-label">Presenter</div><div>${presenter}</div></div>
          <div class="meta-row"><div class="meta-label">Cost</div><div>${cost}</div></div>
        </div>
        ${imageBlock}
        ${description}
      </main>
      <script>
        function triggerPrint() {
          window.focus();
          window.setTimeout(function () {
            try {
              window.print();
            } catch (error) {}
          }, 100);
        }
      </script>
    </body>
  </html>`;
  }

  function openImageViewer(imageUrl, title) {
    if (!imageUrl) {
      return;
    }

    const popup = window.open('', 'vq-image-viewer', 'popup,width=1100,height=900');

    if (!popup) {
      window.open(imageUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    const safeTitle = escapeHtml(title || 'Event image');
    const safeImageUrl = escapeAttribute(imageUrl);

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
        max-width: 960px;
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
      .viewer-close {
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
      .viewer-card {
        background: #ffffff;
        border: 1px solid #ded5ca;
        border-radius: 12px;
        box-shadow: 0 10px 24px rgba(29, 41, 39, 0.08);
        padding: 14px;
      }
      .viewer-image {
        display: block;
        height: auto;
        max-width: 100%;
        width: 100%;
      }
    </style>
  </head>
  <body>
    <main class="viewer-shell">
      <div class="viewer-topbar">
        <h1 class="viewer-title">${safeTitle}</h1>
        <button class="viewer-close" type="button" onclick="window.close()">Close</button>
      </div>
      <div class="viewer-card">
        <img class="viewer-image" src="${safeImageUrl}" alt="${safeTitle}" />
      </div>
    </main>
  </body>
</html>`);
    popup.document.close();
    popup.focus();
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

  function boot() {
    document.querySelectorAll(DEFAULTS.mountSelector).forEach(initFeed);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
