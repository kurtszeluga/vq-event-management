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
    wireSupplyListLinks(root);
    wireEventDetailsLinks(root);
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
    const supplyListTitle = event.supplyListTitle || 'Supply List PDF';
    const supplyListViewerUrl =
      event.supplyListViewerUrl || buildSupplyListViewerUrl(config.sourceUrl, event.id);
    const supplyListLink = event.supplyListUrl
      ? `<a class="vq-feed-secondary" href="${escapeAttribute(supplyListViewerUrl)}" data-supply-list-url="${escapeAttribute(supplyListViewerUrl)}">View/Download ${escapeHtml(supplyListTitle)}</a>`
      : '';
    const registerLink = event.registerUrl
      ? `<a class="vq-feed-primary vq-feed-register-action" href="${escapeAttribute(event.registerUrl)}" target="_blank" rel="noopener noreferrer">${event.registrationIsFull ? 'Join Waitlist' : 'Register'}</a>`
      : '';
    const availabilityLabel = event.registrationAvailability || getRegistrationAvailability(event).label;
    const availabilityTone = event.registrationIsFull ? 'is-waitlist' : 'is-open';
    const registrationStats = getRegistrationStats(event);
    const coordinatorContact = buildCoordinatorContactMarkup(event);

    return `
      <article class="vq-feed-card" data-event-type="${escapeAttribute(event.eventType)}">
        <div class="vq-feed-card-main">
          <div class="vq-feed-card-top">
            <div class="vq-feed-card-top-left">
              <div class="vq-feed-pill-row">
                <span class="vq-feed-type">${escapeHtml(event.eventType)}</span>
                <span class="vq-feed-status-pill ${availabilityTone}">${escapeHtml(availabilityLabel)}</span>
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
          <div class="vq-feed-registration-stats" aria-label="Registration statistics">
            ${registrationStats.map((stat) => `
              <span class="${stat.tone ? `is-${stat.tone}` : ''}">
                <strong>${escapeHtml(stat.value)}</strong>
                ${escapeHtml(stat.label)}
              </span>
            `).join('')}
          </div>
          ${coordinatorContact}
          <div class="vq-feed-actions">
            ${supplyListLink}
            ${event.registrationOpen ? registerLink : ''}
          </div>
        </div>
      </article>
    `;
  }

  function buildCoordinatorContactMarkup(event) {
    const name = event.coordinatorName || '';
    const email = event.coordinatorEmail || '';

    if (!name && !email) {
      return '';
    }

    return `
      <div class="vq-feed-coordinator">
        <strong>Coordinator:</strong>
        ${name ? `<span>${escapeHtml(name)}</span>` : ''}
        ${email ? `<a href="mailto:${escapeAttribute(email)}">${escapeHtml(email)}</a>` : ''}
      </div>
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

  function getRegistrationAvailability(event) {
    if (event.capacityUnlimited) {
      return { isFull: false, label: 'Unlimited' };
    }

    const capacity = Number(event.capacity || 0);

    if (!capacity) {
      return { isFull: false, label: 'Seats available' };
    }

    return Number(event.registeredCount || 0) >= capacity
      ? { isFull: true, label: 'Full - waitlist available' }
      : { isFull: false, label: 'Seats available' };
  }

  function getRegistrationStats(event) {
    const registered = Number(event.registeredCount || 0);
    const waitlisted = Number(event.waitlistedCount || 0);

    if (event.capacityUnlimited) {
      return [
        { label: 'Capacity', value: 'Unlimited' },
        { label: 'Registered', value: String(registered) },
        { label: 'Waitlisted', tone: waitlisted ? 'waitlist' : '', value: String(waitlisted) }
      ];
    }

    const capacity = Number(event.capacity || 0);
    const remaining = capacity ? Math.max(capacity - registered, 0) : null;

    return [
      { label: 'Capacity', value: capacity ? String(capacity) : 'Not Set' },
      { label: 'Registered', value: String(registered) },
      { label: 'Waitlisted', tone: waitlisted ? 'waitlist' : '', value: String(waitlisted) },
      {
        label: registered >= capacity && capacity ? 'Waitlist Available' : 'Open Seats',
        tone: registered >= capacity && capacity ? 'waitlist' : 'open',
        value: remaining === null ? 'N/A' : String(remaining)
      }
    ];
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

  function wireSupplyListLinks(root) {
    root.querySelectorAll('[data-supply-list-url]').forEach((link) => {
      link.addEventListener('click', (event) => {
        const url = link.dataset.supplyListUrl || link.href || '';

        if (!url) {
          return;
        }

        event.preventDefault();

        try {
          window.top.location.href = url;
        } catch {
          window.location.href = url;
        }
      });
    });
  }

  function wireEventDetailsLinks(root) {
    root.querySelectorAll('[data-event-details]').forEach((button) => {
      button.addEventListener('click', () => {
        try {
          openEventDetailsPopup(JSON.parse(button.dataset.eventDetails || '{}'));
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
      .vq-feed-status-pill.is-waitlist {
        background: #fff3c4;
        border: 1px solid #ddc66b;
        color: #7a5200;
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
      .vq-feed-registration-stats {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 10px 0 0;
      }
      .vq-feed-registration-stats span {
        background: #f7f1e8;
        border: 1px solid #decfbd;
        border-radius: 999px;
        color: #36433f;
        display: inline-flex;
        font-size: 0.82rem;
        font-weight: 800;
        gap: 4px;
        padding: 6px 10px;
      }
      .vq-feed-registration-stats strong {
        color: #1d2927;
      }
      .vq-feed-registration-stats .is-open {
        background: #e7f6ea;
        border-color: #8bc79a;
        color: #1f6a31;
      }
      .vq-feed-registration-stats .is-waitlist {
        background: #fff3c4;
        border-color: #ddc66b;
        color: #7a5200;
      }
      .vq-feed-coordinator {
        align-items: center;
        color: #5a6b67;
        display: flex;
        flex-wrap: wrap;
        font-size: 0.92rem;
        gap: 6px;
        margin-top: 10px;
      }
      .vq-feed-coordinator strong {
        color: #1d2927;
      }
      .vq-feed-coordinator a {
        color: #225c56;
        font-weight: 800;
      }
      .vq-feed-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 14px;
        justify-content: flex-start;
      }
      .vq-feed-register-action {
        margin-left: auto;
      }
      @media (max-width: 720px) {
        .vq-feed-card-top {
          flex-direction: column;
        }
        .vq-feed-register-action {
          margin-left: 0;
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

  function buildFileProxyUrl(sourceUrl, fileUrl, fileName, disposition = 'inline') {
    const origin = getSourceOrigin(sourceUrl);
    const params = new URLSearchParams({
      disposition,
      filename: fileName || 'supply-list.pdf',
      url: fileUrl
    });

    return `${origin}/api/file-proxy?${params.toString()}`;
  }

  function buildSupplyListViewerUrl(sourceUrl, eventId) {
    const origin = getSourceOrigin(sourceUrl);

    return `${origin}/events/${encodeURIComponent(eventId || '')}/supply-list`;
  }

  function getSourceOrigin(sourceUrl) {
    try {
      return new URL(sourceUrl, window.location.href).origin;
    } catch {
      return window.location.origin;
    }
  }

  function openEventDetailsPopup(event) {
    if (!event?.id) {
      return;
    }

    const popup = window.open('', 'vq-event-details', 'popup,width=980,height=820');

    if (!popup) {
      window.alert('Please allow popups to view event details.');
      return;
    }

    const html = buildEventDetailsHtml(event);

    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
  }

  function buildEventDetailsHtml(event) {
    const title = escapeHtml(event.title || 'Event');
    const eventType = escapeHtml(event.eventType || 'Other');
    const description = event.description ? `<p class="description">${escapeHtml(event.description)}</p>` : '';
    const date = escapeHtml(formatEventDate(event.date));
    const time = escapeHtml(formatTimeRange(event.startTime, event.endTime));
    const location = escapeHtml(event.location || 'To be announced');
    const presenter = escapeHtml(event.presenter || 'To be announced');
    const cost = escapeHtml(event.isPaid ? formatCurrency(event.cost) : 'Free');
    const registration = escapeHtml(event.registrationOpen ? 'Registration open' : 'Registration closed');
    const imageBlock = event.imageUrl
      ? `<img alt="${title}" class="event-image" src="${escapeAttribute(event.imageUrl)}" />`
      : '';
    const stats = getRegistrationStats(event);

    return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${title}</title>
      <style>
        :root {
          background: #f4efe8;
          color: #1d2927;
          font-family: Inter, Arial, sans-serif;
        }
        html,
        body {
          margin: 0;
          min-height: 100%;
        }
        body {
          padding: 24px;
        }
        .page {
          background: #fffdfa;
          border: 1px solid #ded5ca;
          border-radius: 10px;
          margin: 0 auto;
          max-width: 820px;
          padding: 22px;
        }
        .topbar {
          align-items: flex-start;
          display: flex;
          gap: 16px;
          justify-content: space-between;
        }
        .eyebrow {
          color: #9a4d2f;
          font-size: 12px;
          font-weight: 900;
          letter-spacing: 0.08em;
          margin: 0 0 8px;
          text-transform: uppercase;
        }
        h1 {
          font-size: 28px;
          line-height: 1.15;
          margin: 0;
        }
        .pill-row,
        .stats {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin-top: 14px;
        }
        .pill,
        .stats span {
          background: #e9f2ef;
          border: 1px solid #c6dad5;
          border-radius: 999px;
          color: #225c56;
          display: inline-flex;
          font-size: 13px;
          font-weight: 900;
          gap: 4px;
          padding: 6px 10px;
        }
        .stats .is-waitlist {
          background: #fff3c4;
          border-color: #ddc66b;
          color: #7a5200;
        }
        .stats .is-open {
          background: #e7f6ea;
          border-color: #8bc79a;
          color: #1f6a31;
        }
        .event-image {
          border: 1px solid #ded5ca;
          border-radius: 8px;
          display: block;
          height: auto;
          margin-top: 18px;
          max-height: 280px;
          max-width: 100%;
          object-fit: contain;
        }
        .meta {
          display: grid;
          gap: 10px;
          margin-top: 18px;
        }
        .meta-row {
          display: grid;
          gap: 10px;
          grid-template-columns: 120px 1fr;
        }
        .meta-label {
          color: #5a6b67;
          font-weight: 900;
        }
        .description {
          line-height: 1.55;
          margin: 18px 0 0;
          white-space: pre-wrap;
        }
        .actions {
          display: inline-flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .print-status {
          color: #5a6b67;
          font-size: 13px;
          font-weight: 700;
          margin-top: 10px;
          min-height: 18px;
        }
        .button {
          appearance: none;
          background: #ffffff;
          border: 1px solid #225c56;
          border-radius: 999px;
          color: #225c56;
          cursor: pointer;
          display: inline-flex;
          font: inherit;
          font-weight: 800;
          padding: 9px 14px;
          text-decoration: none;
        }
        .button.primary {
          background: #225c56;
          color: #ffffff;
        }
        @media print {
          body {
            background: #ffffff;
            padding: 0;
          }
          .page {
            border: 0;
            border-radius: 0;
            max-width: none;
          }
          .actions {
            display: none;
          }
        }
        @media (max-width: 640px) {
          body {
            padding: 12px;
          }
          .topbar,
          .meta-row {
            display: grid;
            grid-template-columns: 1fr;
          }
        }
      </style>
    </head>
    <body>
      <main class="page">
        <div class="topbar">
          <div>
            <p class="eyebrow">Event details</p>
            <h1>${title}</h1>
          </div>
          <div class="actions">
            <button class="button primary" type="button" id="print-button">Print</button>
            <button class="button" type="button" onclick="window.close()">Close</button>
          </div>
        </div>
        <div class="print-status" id="print-status" aria-live="polite"></div>
        <div class="pill-row">
          <span class="pill">${eventType}</span>
          <span class="pill">${registration}</span>
        </div>
        <div class="stats">
          ${stats.map((stat) => `
            <span class="${stat.tone ? `is-${stat.tone}` : ''}">
              <strong>${escapeHtml(stat.value)}</strong>
              ${escapeHtml(stat.label)}
            </span>
          `).join('')}
        </div>
        ${imageBlock}
        <div class="meta">
          <div class="meta-row"><div class="meta-label">Date</div><div>${date}</div></div>
          <div class="meta-row"><div class="meta-label">Time</div><div>${time}</div></div>
          <div class="meta-row"><div class="meta-label">Location</div><div>${location}</div></div>
          <div class="meta-row"><div class="meta-label">Presenter</div><div>${presenter}</div></div>
          <div class="meta-row"><div class="meta-label">Cost</div><div>${cost}</div></div>
        </div>
        ${description}
      </main>
      <script>
        (function () {
          var printButton = document.getElementById('print-button');
          var printStatus = document.getElementById('print-status');

          printButton.addEventListener('click', function () {
            printStatus.textContent = 'Opening print dialog...';
            window.focus();

            requestAnimationFrame(function () {
              window.print();
              window.setTimeout(function () {
                printStatus.textContent = '';
              }, 1200);
            });
          });
        })();
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
