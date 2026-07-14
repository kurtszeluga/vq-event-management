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
        ${events.map((event) => buildCardMarkup(event)).join('')}
      </div>
    `;

    if (supportsFilters) {
      wireFilters(root);
    }

    wireDescriptionToggles(root);
  }

  function buildFilterMarkup(payload, events) {
    const types = Object.keys(payload.typeCounts || {}).sort((left, right) => left.localeCompare(right));
    return `
      <div class="vq-feed-filters" aria-label="Event type filters">
        <button class="vq-feed-filter is-active" data-filter="All" type="button">All (${events.length})</button>
        ${types
          .map(
            (type) =>
              `<button class="vq-feed-filter" data-filter="${escapeHtml(type)}" type="button">${escapeHtml(type)} (${payload.typeCounts[type] || 0})</button>`
          )
          .join('')}
      </div>
    `;
  }

  function buildCardMarkup(event) {
    const description = event.description || '';
    const longDescription = description.length > DESCRIPTION_PREVIEW_LENGTH;
    const preview = longDescription
      ? `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trim()}...`
      : description;
    const presenterLabel = event.presenter || event.contactName || event.ownerName || '';
    const cost = event.isPaid ? formatCurrency(event.cost) : 'Free';
    const thumbnail = event.imageUrl
      ? `<img alt="${escapeHtml(event.title)} thumbnail" class="vq-feed-thumb-image" src="${escapeAttribute(event.imageUrl)}" />`
      : '<div class="vq-feed-thumb-placeholder" aria-hidden="true"></div>';
    const supplyListLink = event.supplyListUrl
      ? `<a class="vq-feed-secondary" href="${escapeAttribute(event.supplyListUrl)}" target="_blank" rel="noopener noreferrer">View and print ${escapeHtml(event.supplyListTitle || 'document')}</a>`
      : '';
    const registerLink = event.registerUrl
      ? `<a class="vq-feed-primary" href="${escapeAttribute(event.registerUrl)}" target="_blank" rel="noopener noreferrer">Register</a>`
      : '';

    return `
      <article class="vq-feed-card" data-event-type="${escapeAttribute(event.eventType)}">
        <div class="vq-feed-card-main">
          <div class="vq-feed-card-top">
            <div class="vq-feed-card-top-left">
              <div class="vq-feed-pill-row">
                <span class="vq-feed-type">${escapeHtml(event.eventType)}</span>
                <span class="vq-feed-status-pill ${event.registrationOpen ? 'is-open' : 'is-closed'}">${event.registrationOpen ? 'Registration Open' : 'Registration Closed'}</span>
              </div>
              <div class="vq-feed-status-row">
                ${registerLink ? `<span class="vq-feed-register-wrap">${registerLink}</span>` : ''}
              </div>
              <div class="vq-feed-title-block">
                <div class="vq-feed-date">${escapeHtml(formatEventDate(event.date))}</div>
                <h3>${escapeHtml(event.title)}</h3>
              </div>
            </div>
            <div class="vq-feed-thumb">${thumbnail}</div>
          </div>
          ${description ? `
            <div class="vq-feed-description">
              <p data-role="preview">${escapeHtml(preview)}</p>
              ${longDescription ? `<p class="is-hidden" data-role="full">${escapeHtml(description)}</p>` : ''}
              ${longDescription ? '<button class="vq-feed-text-button" data-action="toggle-description" type="button">Show Full Description</button>' : ''}
            </div>
          ` : ''}
          <dl class="vq-feed-meta">
            <div><dt>Time</dt><dd>${escapeHtml(formatTimeRange(event.startTime, event.endTime))}</dd></div>
            ${presenterLabel ? `<div><dt>Presenter</dt><dd>${escapeHtml(presenterLabel)}</dd></div>` : ''}
            ${event.location ? `<div><dt>Location</dt><dd>${escapeHtml(event.location)}</dd></div>` : ''}
            <div><dt>Cost</dt><dd>${escapeHtml(cost)}</dd></div>
          </dl>
          <div class="vq-feed-actions">
            ${supplyListLink}
            <a class="vq-feed-secondary" href="${escapeAttribute(event.printUrl)}" target="_blank" rel="noopener noreferrer">Print ${escapeHtml(event.eventType)}</a>
            <a class="vq-feed-secondary" href="${escapeAttribute(event.detailUrl)}" target="_blank" rel="noopener noreferrer">View Details</a>
          </div>
        </div>
      </article>
    `;
  }

  function wireFilters(root) {
    const buttons = Array.from(root.querySelectorAll('.vq-feed-filter'));
    const cards = Array.from(root.querySelectorAll('.vq-feed-card'));

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const filterValue = button.dataset.filter || 'All';

        buttons.forEach((item) => item.classList.toggle('is-active', item === button));
        cards.forEach((card) => {
          const matches = filterValue === 'All' || card.dataset.eventType === filterValue;
          card.classList.toggle('is-hidden', !matches);
        });
      });
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
      .vq-feed-status-row {
        align-items: center;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        justify-content: flex-start;
      }
      .vq-feed-register-wrap {
        display: inline-flex;
      }
      .vq-feed-primary,
      .vq-feed-secondary {
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.95rem;
        font-weight: 700;
        padding: 9px 14px;
        text-decoration: none;
        white-space: nowrap;
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
        margin-top: 10px;
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
