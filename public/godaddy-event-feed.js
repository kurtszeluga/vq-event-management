(function () {
  // One flat row of pills, each a single destination the reader picks - there
  // is deliberately no All, and no Events pill above Programs/Workshops.
  //
  // Two things vary underneath. `category` is the feed API's server-side
  // filter (EVENT_CATEGORY_CONFIG in api/_lib/public-event-feed.js), so
  // changing it costs a fetch. `typeFilter` narrows the fetched cards in the
  // browser, which is why Programs and Workshops - both the events category -
  // switch between each other without another request.
  const FEED_VIEWS = [
    { category: 'events', label: 'Programs', typeFilter: 'Programs', value: 'programs' },
    { category: 'events', label: 'Workshops', typeFilter: 'Workshops', value: 'workshops' },
    { category: 'challenges', label: 'Challenges', typeFilter: '', value: 'challenges' },
    { category: 'business', label: 'Business Listings', typeFilter: '', value: 'business' },
    { category: 'forsale', label: 'For Sale', typeFilter: '', value: 'forsale' }
  ];
  const DEFAULTS = {
    emptyMessage: 'No published listings are available right now.',
    limit: 0,
    mountSelector: '[data-vq-feed]',
    sourceUrl: `${getScriptOrigin()}/api/public-events`,
    view: FEED_VIEWS[0].value,
    views: FEED_VIEWS.map((option) => option.value)
  };
  const DESCRIPTION_PREVIEW_LENGTH = 180;
  const STYLE_ID = 'vq-embed-feed-styles';
  const AUTO_ROTATE_INTERVAL_MS = 4000;

  function initFeed(container) {
    const views = parseViewList(container.dataset.categories);
    const requestedView = normalizeViewValue(container.dataset.category) || DEFAULTS.view;
    const config = {
      ...DEFAULTS,
      views,
      // A starting view outside the pill list would leave every pill inactive,
      // so fall back to the first one actually offered.
      view: views.includes(requestedView) ? requestedView : views[0],
      emptyMessage: container.dataset.emptyMessage || DEFAULTS.emptyMessage,
      limit: Number(container.dataset.limit || 0),
      sourceUrl: container.dataset.sourceUrl || DEFAULTS.sourceUrl
    };

    ensureStyles();
    renderShell(container, config);
    loadFeed(container, config);
  }

  // 'events' predates the pill row being flattened, when it meant one pill
  // covering both Programs and Workshops. Treat it as Programs so an older
  // embed keeps working instead of silently falling back to the full set.
  function normalizeViewValue(rawValue) {
    const value = String(rawValue || '').trim().toLowerCase();
    return value === 'events' ? 'programs' : value;
  }

  function parseViewList(rawValue) {
    const requested = String(rawValue || '')
      .split(',')
      .map((entry) => normalizeViewValue(entry))
      .filter(Boolean);
    const known = new Set(FEED_VIEWS.map((option) => option.value));
    const seen = new Set();
    const resolved = [];

    requested.forEach((value) => {
      if (known.has(value) && !seen.has(value)) {
        seen.add(value);
        resolved.push(value);
      }
    });

    // No attribute, or nothing in it the feed serves, means show them all - a
    // typo should not silently strip the row down to one pill.
    return resolved.length ? resolved : FEED_VIEWS.map((option) => option.value);
  }

  function getActiveView(config) {
    return FEED_VIEWS.find((option) => option.value === config.view) || FEED_VIEWS[0];
  }

  async function loadFeed(container, config) {
    const root = container.querySelector('.vq-feed-root');
    // Tracked per container, not globally: a page can mount several feeds, and
    // a shared counter would let each new mount discard the others' responses.
    // Bumping it means a slow earlier category cannot overwrite whichever one
    // the reader has since clicked.
    config.requestId = (config.requestId || 0) + 1;
    const requestId = config.requestId;

    try {
      root.innerHTML = '<div class="vq-feed-loading">Loading listings...</div>';
      const url = new URL(config.sourceUrl, window.location.href);
      url.searchParams.set('category', getActiveView(config).category);

      const response = await fetch(url.toString(), {
        headers: {
          Accept: 'application/json'
        }
      });

      if (requestId !== config.requestId) {
        return;
      }

      if (!response.ok) {
        throw new Error('Feed request failed.');
      }

      const payload = await response.json();

      if (requestId !== config.requestId) {
        return;
      }

      const events = config.limit > 0 ? payload.events.slice(0, config.limit) : payload.events;
      config.loadedCategory = getActiveView(config).category;
      renderFeed(container, events, config);
    } catch {
      config.loadedCategory = '';
      if (requestId === config.requestId) {
        root.innerHTML = '<div class="vq-feed-error">The event feed could not be loaded right now.</div>';
      }
    }
  }

  function renderFeed(container, events, config) {
    const root = container.querySelector('.vq-feed-root');

    if (!events.length) {
      root.innerHTML = `<div class="vq-feed-empty">${escapeHtml(config.emptyMessage)}</div>`;
      return;
    }

    // The empty notice ships alongside the list rather than replacing it,
    // because a view like Programs can filter every fetched card out of sight
    // and still need those cards intact for the next pill.
    root.innerHTML = `
      <div class="vq-feed-list">
        ${events.map((event) => buildCardMarkup(event, config)).join('')}
      </div>
      <div class="vq-feed-empty is-hidden" data-role="filtered-empty">${escapeHtml(config.emptyMessage)}</div>
    `;

    applyActiveView(container, config);
    wireDescriptionToggles(root);
    wireImageCarousels(root);
    wireImageViewerLinks(root);
    wireSupplyListLinks(root);
    wireEventDetailsLinks(root);
  }

  function applyActiveView(container, config) {
    const root = container.querySelector('.vq-feed-root');
    const cards = Array.from(root.querySelectorAll('.vq-feed-card'));
    const { typeFilter } = getActiveView(config);

    if (typeFilter) {
      applyFilter(typeFilter, cards);
    } else {
      cards.forEach((card) => card.classList.remove('is-hidden'));
    }

    const list = root.querySelector('.vq-feed-list');
    const emptyNotice = root.querySelector('[data-role="filtered-empty"]');
    const hasVisible = cards.some((card) => !card.classList.contains('is-hidden'));

    if (list) {
      list.classList.toggle('is-hidden', !hasVisible);
    }

    if (emptyNotice) {
      emptyNotice.classList.toggle('is-hidden', hasVisible);
    }
  }

  function buildCardMarkup(event, config) {
    const description = event.description || '';
    const longDescription = description.length > DESCRIPTION_PREVIEW_LENGTH;
    const preview = longDescription
      ? `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trim()}...`
      : description;
    const presenterLabel = event.presenter || event.contactName || event.ownerName || '';
    const paymentDetails = getPaymentDetails(event);
    const thumbnail = buildThumbnailMarkup(getEventImages(event), event.title || 'Event', event.placeholderImageUrl);
    const supplyListTitle = event.supplyListTitle || 'Supply List PDF';
    const supplyListViewerUrl =
      event.supplyListViewerUrl || buildSupplyListViewerUrl(config.sourceUrl, event.id);
    const supplyListLink = event.supplyListUrl
      ? `<a class="vq-feed-secondary" href="${escapeAttribute(supplyListViewerUrl)}" data-supply-list-url="${escapeAttribute(supplyListViewerUrl)}">View/Download ${escapeHtml(supplyListTitle)}</a>`
      : '';
    const registerUrl = event.registrationOpen ? buildRegistrationUrl(config.sourceUrl, event) : '';
    const registerLink = registerUrl
      ? `<a class="vq-feed-primary vq-feed-register-action" href="${escapeAttribute(registerUrl)}" target="_blank" rel="noopener noreferrer">${event.registrationIsFull ? 'Join Waitlist' : 'Register'}</a>`
      : '';
    const availabilityLabel = event.registrationAvailability || getRegistrationAvailability(event).label;
    const availabilityTone = availabilityLabel === 'Unlimited'
      ? 'is-open'
      : event.registrationIsFull
      ? 'is-waitlist'
      : event.registrationOpen
        ? 'is-open'
        : 'is-closed';
    const registrationStats = getRegistrationStats(event);
    const coordinatorContact = buildCoordinatorContactMarkup(event);
    // Business Listing and For Sale carry no date, time, presenter, payment or
    // registration of their own, so the event treatment below reads as a wall
    // of "TBD"/"Registration Closed" on them. The feed API sends the same
    // field list the site's own listing cards render - see
    // shared/eventListing.js.
    const listingDetails = Array.isArray(event.listingDetails) ? event.listingDetails : [];
    const isListing = Boolean(event.isListing) && listingDetails.length > 0;

    return `
      <article class="vq-feed-card" data-event-type="${escapeAttribute(event.eventType)}">
        <div class="vq-feed-card-main">
          <div class="vq-feed-card-top">
            <div class="vq-feed-card-top-left">
              <div class="vq-feed-pill-row">
                <span class="vq-feed-type">${escapeHtml(event.eventType)}</span>
                ${isListing ? '' : `
                  <span class="vq-feed-status-pill ${availabilityTone}">${escapeHtml(availabilityLabel)}</span>
                  <span class="vq-feed-status-pill ${event.registrationOpen ? 'is-open' : 'is-closed'}">${event.registrationOpen ? 'Registration Open' : 'Registration Closed'}</span>
                `}
              </div>
              <div class="vq-feed-title-block">
                ${isListing ? '' : `<div class="vq-feed-date">${escapeHtml(formatEventDate(event.date))}</div>`}
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
          ${isListing ? buildListingMetaMarkup(listingDetails) : `
            <dl class="vq-feed-meta">
              ${event.eventType === 'Challenges' ? '' : `<div><dt>Time</dt><dd>${escapeHtml(formatTimeRange(event.startTime, event.endTime))}</dd></div>`}
              ${event.registrationOpenAt || event.registrationCloseAt ? `<div><dt>Registration Open/Closes</dt><dd>${escapeHtml(formatRegistrationDateRange(event))}</dd></div>` : ''}
              ${presenterLabel ? `<div><dt>Presenter</dt><dd>${escapeHtml(presenterLabel)}</dd></div>` : ''}
              ${event.location ? `<div><dt>Location</dt><dd>${escapeHtml(event.location)}</dd></div>` : ''}
              <div class="vq-feed-payment-detail">
                <dt>Payment</dt>
                <dd>${paymentDetails}</dd>
              </div>
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
          `}
          <div class="vq-feed-actions">
            ${supplyListLink}
            ${isListing ? '' : event.registrationOpen ? registerLink : ''}
          </div>
        </div>
      </article>
    `;
  }

  function buildListingMetaMarkup(details) {
    return `
      <dl class="vq-feed-meta">
        ${details
          .map((detail) => {
            const value = String(detail.value == null ? '' : detail.value);
            const safeValue = escapeHtml(value);
            const rendered = detail.link === 'email'
              ? `<a href="mailto:${escapeAttribute(value)}">${safeValue}</a>`
              : detail.link === 'phone'
                ? `<a href="tel:${escapeAttribute(value.replace(/[^0-9+]/g, ''))}">${safeValue}</a>`
                : safeValue;

            return `<div><dt>${escapeHtml(detail.label || '')}</dt><dd>${rendered}</dd></div>`;
          })
          .join('')}
      </dl>
    `;
  }

  // imageUrls (the full set) only started arriving in the feed once this
  // feature shipped; imageUrl (singular, first photo) is the older field
  // and stays as a fallback for a feed response that predates it.
  function getEventImages(event) {
    if (Array.isArray(event.imageUrls) && event.imageUrls.length) {
      return event.imageUrls.filter(Boolean);
    }

    return event.imageUrl ? [event.imageUrl] : [];
  }

  function formatPhotoCountLabel(count) {
    return count === 1 ? '1 Photo' : `${count} Photos`;
  }

  function buildThumbnailMarkup(images, title, placeholderImageUrl) {
    if (!images.length) {
      // Same default quilt-block image the main site shows for this event
      // type when nothing has been uploaded - not clickable/zoomable, unlike
      // a real photo, since there is nothing more to show. Business Listing
      // and For Sale have no placeholder mapping and keep the flat box.
      if (placeholderImageUrl) {
        return `
          <div class="vq-feed-thumb-stack">
            <img alt="${escapeHtml(title)}" class="vq-feed-thumb-image" src="${escapeAttribute(placeholderImageUrl)}" />
          </div>
        `;
      }

      return '<div class="vq-feed-thumb-placeholder" aria-hidden="true"></div>';
    }

    const countCaption = `<p class="vq-feed-thumb-count">${formatPhotoCountLabel(images.length)}</p>`;
    const hint = '<span class="vq-feed-thumb-hint">Click image for larger view</span>';

    if (images.length === 1) {
      return `
        <div class="vq-feed-thumb-stack">
          <button
            class="vq-feed-thumb-link"
            type="button"
            data-action="open-viewer"
            data-images="${escapeAttribute(JSON.stringify(images))}"
            data-title="${escapeAttribute(title)}"
            data-start-index="0"
            aria-label="Open larger image for ${escapeHtml(title)}"
          >
            <img alt="${escapeHtml(title)} thumbnail" class="vq-feed-thumb-image" src="${escapeAttribute(images[0])}" />
          </button>
          ${countCaption}
          ${hint}
        </div>
      `;
    }

    const dots = images
      .map((_, dotIndex) => `<span class="vq-feed-carousel-dot${dotIndex === 0 ? ' is-active' : ''}"></span>`)
      .join('');

    return `
      <div class="vq-feed-thumb-stack">
        <div class="vq-feed-carousel" data-images="${escapeAttribute(JSON.stringify(images))}" data-title="${escapeAttribute(title)}" data-index="0">
          <button class="vq-feed-carousel-image-button" type="button" data-action="open-viewer" aria-label="Open larger view for ${escapeHtml(title)}">
            <img
              alt="${escapeHtml(title)} thumbnail - photo 1 of ${images.length}"
              class="vq-feed-thumb-image"
              data-role="carousel-image"
              src="${escapeAttribute(images[0])}"
            />
          </button>
          <button class="vq-feed-carousel-arrow vq-feed-carousel-arrow-prev" type="button" data-action="prev" aria-label="Previous photo">
            <span class="vq-feed-carousel-chevron vq-feed-carousel-chevron-prev" aria-hidden="true"></span>
          </button>
          <button class="vq-feed-carousel-arrow vq-feed-carousel-arrow-next" type="button" data-action="next" aria-label="Next photo">
            <span class="vq-feed-carousel-chevron vq-feed-carousel-chevron-next" aria-hidden="true"></span>
          </button>
          <button class="vq-feed-carousel-toggle" type="button" data-action="toggle-pause" aria-pressed="false" aria-label="Pause automatic photo rotation">
            <span class="vq-feed-carousel-pause-icon" data-role="toggle-icon" aria-hidden="true">
              <span class="vq-feed-carousel-pause-bar"></span>
              <span class="vq-feed-carousel-pause-bar"></span>
            </span>
          </button>
          <div class="vq-feed-carousel-dots" data-role="dots" aria-hidden="true">${dots}</div>
        </div>
        ${countCaption}
        ${hint}
      </div>
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
        <strong>For Questions Contact:</strong>
        ${name ? `<span>${escapeHtml(name)}</span>` : ''}
        ${email ? `<a href="mailto:${escapeAttribute(email)}">${escapeHtml(email)}</a>` : ''}
      </div>
    `;
  }

  function getPaymentDetails(event) {
    if (!event.isPaid) {
      return '<strong>No Charge</strong>';
    }

    const cost = Number(event.cost || 0);
    const serviceFee = Number(event.serviceFee || 0);
    const total = cost + serviceFee;
    const payLater = event.cashCheckOnly
      ? '<span class="vq-feed-payment-note">Cash/check only - online payment not accepted</span>'
      : event.allowCashCheckPayment
        ? '<span class="vq-feed-payment-note">Cash/check later available</span>'
        : '';

    const breakdown = serviceFee > 0
      ? `<span class="vq-feed-payment-breakdown">${escapeHtml(formatCurrency(cost))} + ${escapeHtml(formatCurrency(serviceFee))} service fee</span>`
      : '';

    return `
      <strong>${escapeHtml(formatCurrency(total))} total</strong>
      ${breakdown}
      ${payLater}
    `;
  }

  function buildRegistrationUrl(sourceUrl, event) {
    try {
      const origin = getSourceOrigin(sourceUrl);
      const url = new URL(`/register?eventId=${encodeURIComponent(event.id || '')}`, origin);
      const returnUrl = getSafeReturnUrl(window.location.href);
      if (returnUrl) {
        url.searchParams.set('returnUrl', returnUrl);
      }
      return url.toString();
    } catch {
      return event.registerUrl || '';
    }
  }

  function getSafeReturnUrl(value) {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
    } catch {
      return '';
    }
  }

  function getPaymentTotal(event) {
    return Number(event.cost || 0) + Number(event.serviceFee || 0);
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

    const seatHoldingCount = Number(event.registeredCount || 0)
      + Number(event.pendingPaymentCount || 0)
      + Number(event.heldCount || 0);

    return seatHoldingCount >= capacity
      ? {
        isFull: true,
        label: Number(event.heldCount || 0)
          ? 'Seat on hold - waitlist available'
          : Number(event.pendingPaymentCount || 0)
            ? 'Seat pending payment - waitlist available'
            : 'Full - waitlist available'
      }
      : { isFull: false, label: 'Seats available' };
  }

  function getRegistrationStats(event) {
    const registered = Number(event.registeredCount || 0);
    const pendingPayment = Number(event.pendingPaymentCount || 0);
    const waitlisted = Number(event.waitlistedCount || 0);
    const held = Number(event.heldCount || 0);

    if (event.capacityUnlimited) {
      return [
        { label: 'Capacity', value: 'Unlimited' },
        { label: 'Registered', value: String(registered) },
        { label: 'Pending Payment', tone: pendingPayment ? 'waitlist' : '', value: String(pendingPayment) },
        { label: 'Waitlisted', tone: waitlisted ? 'waitlist' : '', value: String(waitlisted) }
      ];
    }

    const capacity = Number(event.capacity || 0);
    const remaining = capacity ? Math.max(capacity - registered - pendingPayment - held, 0) : null;

    return [
      { label: 'Capacity', value: capacity ? String(capacity) : 'Not Set' },
      { label: 'Registered', value: String(registered) },
      { label: 'Pending Payment', tone: pendingPayment ? 'waitlist' : '', value: String(pendingPayment) },
      { label: 'Waitlisted', tone: waitlisted ? 'waitlist' : '', value: String(waitlisted) },
      {
        label: remaining === 0 && capacity ? 'Waitlist Available' : 'Open Seats',
        tone: remaining === 0 && capacity ? 'waitlist' : 'open',
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

  function renderShell(container, config) {
    // The pill row sits outside .vq-feed-root on purpose: renderFeed replaces
    // the root wholesale for the loading, empty and error states, and a view
    // with nothing in it would otherwise take the switcher down with it.
    container.innerHTML = `
      ${buildViewPillMarkup(config)}
      <div class="vq-feed-root"></div>
    `;
    wireViewPills(container, config);
  }

  function buildViewPillMarkup(config) {
    if (config.views.length < 2) {
      return '';
    }

    return `
      <div class="vq-feed-controls" role="group" aria-label="Listing views">
        ${config.views
          .map((value) => {
            const option = FEED_VIEWS.find((entry) => entry.value === value);
            const isActive = value === config.view;

            return `<button aria-pressed="${isActive}" class="vq-feed-category${isActive ? ' is-active' : ''}" data-view="${escapeAttribute(value)}" type="button">${escapeHtml(option.label)}</button>`;
          })
          .join('')}
      </div>
    `;
  }

  function wireViewPills(container, config) {
    const buttons = Array.from(container.querySelectorAll('.vq-feed-category'));

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextView = button.dataset.view || DEFAULTS.view;

        if (nextView === config.view) {
          return;
        }

        config.view = nextView;
        buttons.forEach((item) => {
          const isActive = item === button;
          item.classList.toggle('is-active', isActive);
          item.setAttribute('aria-pressed', String(isActive));
        });

        // Programs and Workshops are both the events category, so moving
        // between them only re-filters what is already on screen.
        if (getActiveView(config).category === config.loadedCategory) {
          applyActiveView(container, config);
        } else {
          loadFeed(container, config);
        }
      });
    });
  }

  function wireImageCarousels(root) {
    root.querySelectorAll('.vq-feed-carousel').forEach((carousel) => {
      let images = [];

      try {
        images = JSON.parse(carousel.dataset.images || '[]');
      } catch {
        return;
      }

      if (!Array.isArray(images) || images.length < 2) {
        return;
      }

      const image = carousel.querySelector('[data-role="carousel-image"]');
      const dots = carousel.querySelectorAll('[data-role="dots"] .vq-feed-carousel-dot');
      const toggleButton = carousel.querySelector('[data-action="toggle-pause"]');
      const toggleIcon = carousel.querySelector('[data-role="toggle-icon"]');
      const title = carousel.dataset.title || 'Event';
      let isPaused = false;
      let intervalId = null;

      function render() {
        const index = Number(carousel.dataset.index) || 0;

        if (image) {
          image.src = images[index];
          image.alt = `${title} thumbnail - photo ${index + 1} of ${images.length}`;
        }

        dots.forEach((dot, dotIndex) => {
          dot.classList.toggle('is-active', dotIndex === index);
        });
      }

      function goTo(delta) {
        const current = Number(carousel.dataset.index) || 0;
        const next = (current + delta + images.length) % images.length;
        carousel.dataset.index = String(next);
        render();
      }

      function stopAutoRotate() {
        if (intervalId !== null) {
          window.clearInterval(intervalId);
          intervalId = null;
        }
      }

      function startAutoRotate() {
        stopAutoRotate();

        if (isPaused) {
          return;
        }

        intervalId = window.setInterval(() => goTo(1), AUTO_ROTATE_INTERVAL_MS);
      }

      carousel.querySelector('[data-action="prev"]')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        goTo(-1);
        startAutoRotate();
      });

      carousel.querySelector('[data-action="next"]')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        goTo(1);
        startAutoRotate();
      });

      toggleButton?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        isPaused = !isPaused;
        toggleButton.setAttribute('aria-pressed', String(isPaused));
        toggleButton.setAttribute(
          'aria-label',
          isPaused ? 'Resume automatic photo rotation' : 'Pause automatic photo rotation'
        );

        if (toggleIcon) {
          toggleIcon.className = isPaused ? 'vq-feed-carousel-play-icon' : 'vq-feed-carousel-pause-icon';
          toggleIcon.innerHTML = isPaused
            ? ''
            : '<span class="vq-feed-carousel-pause-bar"></span><span class="vq-feed-carousel-pause-bar"></span>';
        }

        startAutoRotate();
      });

      startAutoRotate();
    });
  }

  function wireImageViewerLinks(root) {
    root.querySelectorAll('[data-action="open-viewer"]').forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();

        const carousel = trigger.closest('.vq-feed-carousel');
        const source = carousel || trigger;
        let images = [];

        try {
          images = JSON.parse(source.dataset.images || '[]');
        } catch {
          images = [];
        }

        const title = source.dataset.title || 'Event image';
        const startIndex = carousel ? Number(carousel.dataset.index) || 0 : Number(trigger.dataset.startIndex) || 0;

        openImageViewer(images, title, startIndex);
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
      /* The mount fills whatever it is dropped into. GoDaddy's HTML block
         wraps the embed in "display: flex; justify-content: center", which
         makes it a flex item - and a flex item sizes to max-content, so the
         feed's width tracked whichever card happened to be widest and changed
         every time the reader switched pills. A definite width resolves
         against the container in both a flex and a plain block parent. */
      [data-vq-feed] {
        box-sizing: border-box;
        min-width: 0;
        width: 100%;
      }
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
      .vq-feed-controls {
        align-items: center;
        border-bottom: 1px solid #ded5ca;
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin: 0 0 18px;
        padding: 0 0 16px;
      }
      .vq-feed-category {
        appearance: none;
        background: #ffffff;
        border: 1px solid #c8d4d0;
        border-radius: 999px;
        color: #1d2927;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 10px 16px;
      }
      .vq-feed-category:hover {
        border-color: #225c56;
      }
      .vq-feed-category.is-active {
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
      .vq-feed-list.is-hidden,
      .vq-feed-empty.is-hidden,
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
        /* Pinned to the image width. Without this the column sizes to its
           widest child, so the "Click image for larger view" hint made every
           card carrying it wider than one showing just an image, and the text
           beside it correspondingly narrower. */
        width: 172px;
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
      .vq-feed-thumb-count {
        color: #5a6b67;
        font-size: 0.78rem;
        font-weight: 700;
        margin: 0;
      }
      .vq-feed-carousel {
        border-radius: 8px;
        height: 132px;
        position: relative;
        width: 172px;
      }
      .vq-feed-carousel-image-button {
        appearance: none;
        background: none;
        border: 0;
        cursor: pointer;
        display: block;
        padding: 0;
      }
      .vq-feed-carousel-arrow {
        align-items: center;
        appearance: none;
        background: rgba(29, 41, 39, 0.55);
        border: 0;
        border-radius: 999px;
        cursor: pointer;
        display: flex;
        height: 26px;
        justify-content: center;
        position: absolute;
        top: 53px;
        width: 26px;
      }
      .vq-feed-carousel-arrow-prev {
        left: 6px;
      }
      .vq-feed-carousel-arrow-next {
        right: 6px;
      }
      .vq-feed-carousel-chevron {
        border-right: 2px solid #ffffff;
        border-top: 2px solid #ffffff;
        height: 7px;
        width: 7px;
      }
      .vq-feed-carousel-chevron-prev {
        transform: rotate(-135deg);
        margin-left: 2px;
      }
      .vq-feed-carousel-chevron-next {
        transform: rotate(45deg);
        margin-right: 2px;
      }
      .vq-feed-carousel-toggle {
        align-items: center;
        appearance: none;
        background: rgba(29, 41, 39, 0.55);
        border: 0;
        border-radius: 999px;
        bottom: 6px;
        cursor: pointer;
        display: flex;
        height: 22px;
        justify-content: center;
        position: absolute;
        right: 6px;
        width: 22px;
      }
      .vq-feed-carousel-pause-icon {
        display: flex;
        gap: 3px;
      }
      .vq-feed-carousel-pause-bar {
        background: #ffffff;
        height: 10px;
        width: 3px;
      }
      .vq-feed-carousel-play-icon {
        border-bottom: 5px solid transparent;
        border-left: 8px solid #ffffff;
        border-top: 5px solid transparent;
        height: 0;
        margin-left: 2px;
        width: 0;
      }
      .vq-feed-carousel-dots {
        bottom: 6px;
        display: flex;
        gap: 4px;
        justify-content: center;
        left: 6px;
        position: absolute;
      }
      .vq-feed-carousel-dot {
        background: rgba(255, 255, 255, 0.55);
        border-radius: 999px;
        display: inline-block;
        height: 5px;
        width: 5px;
      }
      .vq-feed-carousel-dot.is-active {
        background: #ffffff;
      }
      .vq-feed-description {
        margin-top: 8px;
        /* Capped to a readable measure rather than the card width. The site's
           own cards get this for free - their large photo column bounds the
           text - but the embed's thumbnail is small, so a long description ran
           the full width of the card in lines too long to track. */
        max-width: 78ch;
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
      .vq-feed-meta dd a {
        color: #225c56;
        font-weight: 800;
      }
      .vq-feed-payment-detail dd {
        display: grid;
        gap: 3px;
      }
      .vq-feed-payment-breakdown,
      .vq-feed-payment-note {
        color: #5a6b67;
        font-size: 0.86rem;
      }
      .vq-feed-payment-note {
        color: #225c56;
        font-weight: 800;
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
      @media (max-width: 720px) {
        .vq-feed-card-top {
          flex-direction: column;
        }
        .vq-feed-thumb-image,
        .vq-feed-thumb-placeholder,
        .vq-feed-thumb-stack {
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

  function formatRegistrationDateRange(event) {
    const startDate = event.registrationOpenAt
      ? formatEventDate(event.registrationOpenAt)
      : 'Date TBD';
    const endDate = event.registrationCloseAt
      ? formatEventDate(event.registrationCloseAt)
      : 'Date TBD';

    return `${startDate} - ${endDate}`;
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
      || eventType === 'Retreat'
      || eventType === 'Class (Half Day)'
      || eventType === 'Class (Full Day)'
      || eventType === 'Class (Half-Day)'
      || eventType === 'Class (Full-Day)'
      || eventType === 'Other';
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

  function getScriptOrigin() {
    try {
      const script = document.currentScript || document.querySelector('script[src*="godaddy-event-feed"]');
      return script?.src ? new URL(script.src).origin : window.location.origin;
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
    const dateRow = event.eventType === 'Challenges'
      ? ''
      : `<div class="meta-row"><div class="meta-label">Date</div><div>${escapeHtml(formatEventDate(event.date))}</div></div>`;
    const timeRow = event.eventType === 'Challenges'
      ? ''
      : `<div class="meta-row"><div class="meta-label">Time</div><div>${escapeHtml(formatTimeRange(event.startTime, event.endTime))}</div></div>`;
    const registrationWindow = event.registrationOpenAt || event.registrationCloseAt
      ? `<div class="meta-row"><div class="meta-label">Registration Open/Closes</div><div>${escapeHtml(formatRegistrationDateRange(event))}</div></div>`
      : '';
    const location = escapeHtml(event.location || 'To be announced');
    const presenter = escapeHtml(event.presenter || 'To be announced');
    const cost = event.isPaid
      ? `${escapeHtml(formatCurrency(getPaymentTotal(event)))} total${Number(event.serviceFee || 0) > 0 ? ` (${escapeHtml(formatCurrency(event.cost || 0))} + ${escapeHtml(formatCurrency(event.serviceFee || 0))} service fee)` : ''}${event.cashCheckOnly ? ' - cash/check only' : ''}`
      : 'No Charge';
    const registration = escapeHtml(event.registrationOpen ? 'Registration open' : 'Registration closed');
    const imageBlock = event.imageUrl || event.placeholderImageUrl
      ? `<img alt="${title}" class="event-image" src="${escapeAttribute(event.imageUrl || event.placeholderImageUrl)}" />`
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
              ${dateRow}
              ${timeRow}
              ${registrationWindow}
              <div class="meta-row"><div class="meta-label">Location</div><div>${location}</div></div>
          <div class="meta-row"><div class="meta-label">Presenter</div><div>${presenter}</div></div>
          <div class="meta-row"><div class="meta-label">Payment</div><div>${cost}</div></div>
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

  function openImageViewer(images, title, startIndex) {
    const gallery = Array.isArray(images) ? images.filter(Boolean) : [images].filter(Boolean);

    if (!gallery.length) {
      return;
    }

    const popup = window.open('', 'vq-image-viewer', 'popup,width=1100,height=900');

    if (!popup) {
      window.open(gallery[0], '_blank', 'noopener,noreferrer');
      return;
    }

    const safeTitle = escapeHtml(title || 'Event image');
    const hasMultiple = gallery.length > 1;
    const initialIndex = hasMultiple
      ? ((Number(startIndex) || 0) % gallery.length + gallery.length) % gallery.length
      : 0;

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
        position: relative;
      }
      .viewer-image {
        border-radius: 6px;
        display: block;
        height: auto;
        max-width: 100%;
        width: 100%;
      }
      .viewer-caption {
        color: #5a6b67;
        font-size: 0.9rem;
        font-weight: 700;
        margin: 10px 0 0;
        text-align: center;
      }
      .viewer-arrow {
        align-items: center;
        appearance: none;
        background: rgba(29, 41, 39, 0.55);
        border: 0;
        border-radius: 999px;
        cursor: pointer;
        display: flex;
        height: 44px;
        justify-content: center;
        position: absolute;
        top: 50%;
        transform: translateY(-50%);
        width: 44px;
      }
      .viewer-arrow-prev {
        left: 24px;
      }
      .viewer-arrow-next {
        right: 24px;
      }
      .viewer-chevron {
        border-right: 3px solid #ffffff;
        border-top: 3px solid #ffffff;
        height: 12px;
        width: 12px;
      }
      .viewer-chevron-prev {
        margin-left: 4px;
        transform: rotate(-135deg);
      }
      .viewer-chevron-next {
        margin-right: 4px;
        transform: rotate(45deg);
      }
      .viewer-toggle {
        align-items: center;
        appearance: none;
        background: rgba(29, 41, 39, 0.55);
        border: 0;
        border-radius: 999px;
        bottom: 24px;
        cursor: pointer;
        display: flex;
        height: 36px;
        justify-content: center;
        position: absolute;
        right: 24px;
        width: 36px;
      }
      .viewer-pause-icon {
        display: flex;
        gap: 4px;
      }
      .viewer-pause-bar {
        background: #ffffff;
        height: 14px;
        width: 4px;
      }
      .viewer-play-icon {
        border-bottom: 7px solid transparent;
        border-left: 11px solid #ffffff;
        border-top: 7px solid transparent;
        height: 0;
        margin-left: 3px;
        width: 0;
      }
      .viewer-dots {
        bottom: 24px;
        display: flex;
        gap: 6px;
        justify-content: center;
        left: 0;
        position: absolute;
        right: 0;
      }
      .viewer-dot {
        background: rgba(255, 255, 255, 0.55);
        border-radius: 999px;
        display: inline-block;
        height: 8px;
        width: 8px;
      }
      .viewer-dot.is-active {
        background: #ffffff;
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
        <img class="viewer-image" id="viewer-image" src="" alt="${safeTitle}" />
        ${hasMultiple ? `
          <button class="viewer-arrow viewer-arrow-prev" type="button" id="viewer-prev" aria-label="Previous photo">
            <span class="viewer-chevron viewer-chevron-prev" aria-hidden="true"></span>
          </button>
          <button class="viewer-arrow viewer-arrow-next" type="button" id="viewer-next" aria-label="Next photo">
            <span class="viewer-chevron viewer-chevron-next" aria-hidden="true"></span>
          </button>
          <button class="viewer-toggle" type="button" id="viewer-toggle" aria-pressed="false" aria-label="Pause automatic photo rotation">
            <span class="viewer-pause-icon" id="viewer-toggle-icon" aria-hidden="true">
              <span class="viewer-pause-bar"></span>
              <span class="viewer-pause-bar"></span>
            </span>
          </button>
          <div class="viewer-dots" id="viewer-dots" aria-hidden="true">
            ${gallery.map((_, dotIndex) => `<span class="viewer-dot" data-dot-index="${dotIndex}"></span>`).join('')}
          </div>
        ` : ''}
      </div>
      ${hasMultiple ? '<p class="viewer-caption" id="viewer-caption"></p>' : ''}
    </main>
    <script>
      (function () {
        var images = ${JSON.stringify(gallery)};
        var title = ${JSON.stringify(title || 'Event image')};
        var index = ${initialIndex};
        var isPaused = false;
        var intervalId = null;
        var image = document.getElementById('viewer-image');
        var caption = document.getElementById('viewer-caption');
        var dots = document.querySelectorAll('#viewer-dots .viewer-dot');
        var toggleButton = document.getElementById('viewer-toggle');
        var toggleIcon = document.getElementById('viewer-toggle-icon');

        function render() {
          image.src = images[index];
          image.alt = images.length > 1 ? title + ' - photo ' + (index + 1) + ' of ' + images.length : title;

          if (caption) {
            caption.textContent = 'Photo ' + (index + 1) + ' of ' + images.length;
          }

          for (var i = 0; i < dots.length; i++) {
            dots[i].classList.toggle('is-active', i === index);
          }
        }

        function goTo(delta) {
          index = (index + delta + images.length) % images.length;
          render();
        }

        function stopAutoRotate() {
          if (intervalId !== null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
        }

        function startAutoRotate() {
          stopAutoRotate();

          if (isPaused || images.length < 2) {
            return;
          }

          intervalId = window.setInterval(function () {
            goTo(1);
          }, ${AUTO_ROTATE_INTERVAL_MS});
        }

        render();

        var prevButton = document.getElementById('viewer-prev');
        var nextButton = document.getElementById('viewer-next');

        if (prevButton) {
          prevButton.addEventListener('click', function () {
            goTo(-1);
            startAutoRotate();
          });
        }

        if (nextButton) {
          nextButton.addEventListener('click', function () {
            goTo(1);
            startAutoRotate();
          });
        }

        if (toggleButton) {
          toggleButton.addEventListener('click', function () {
            isPaused = !isPaused;
            toggleButton.setAttribute('aria-pressed', String(isPaused));
            toggleButton.setAttribute(
              'aria-label',
              isPaused ? 'Resume automatic photo rotation' : 'Pause automatic photo rotation'
            );
            toggleIcon.className = isPaused ? 'viewer-play-icon' : 'viewer-pause-icon';
            toggleIcon.innerHTML = isPaused
              ? ''
              : '<span class="viewer-pause-bar"></span><span class="viewer-pause-bar"></span>';
            startAutoRotate();
          });
        }

        startAutoRotate();
      })();
    </script>
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
