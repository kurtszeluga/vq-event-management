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
  // Each page carries its own embed, so the layout is a per-mount choice rather
  // than one global look: `data-layout` picks the geometry, and the three card
  // templates below fill it. Roster is the default because it is the shape
  // every existing snippet already renders - an older embed with no attribute
  // must not silently change on the next deploy.
  const LAYOUTS = ['roster', 'grid', 'agenda'];
  const LAYOUT_LABELS = { agenda: 'Agenda', grid: 'Grid', roster: 'Roster' };
  const DEFAULTS = {
    emptyMessage: 'No published listings are available right now.',
    layout: LAYOUTS[0],
    layoutSwitcher: false,
    limit: 0,
    mountSelector: '[data-vq-feed]',
    sourceUrl: `${getScriptOrigin()}/api/public-events`,
    view: FEED_VIEWS[0].value,
    views: FEED_VIEWS.map((option) => option.value)
  };
  const DESCRIPTION_PREVIEW_LENGTH = 180;
  const STYLE_ID = 'vq-embed-feed-styles';
  const AUTO_ROTATE_INTERVAL_MS = 4000;
  const SEAT_METER_MAX_SEGMENTS = 40;
  const MONTH_LABELS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

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
      layout: parseLayout(container.dataset.layout),
      layoutSwitcher: parseLayoutSwitcher(container.dataset.layoutSwitcher),
      limit: Number(container.dataset.limit || 0),
      sourceUrl: container.dataset.sourceUrl || DEFAULTS.sourceUrl
    };

    // A starting layout the switcher does not offer would leave every layout
    // button unpressed - the same trap as a starting view outside the pills.
    if (config.layoutSwitcher && !config.layoutSwitcher.includes(config.layout)) {
      config.layout = config.layoutSwitcher[0];
    }

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

  function parseLayout(rawValue) {
    const value = String(rawValue || '').trim().toLowerCase();
    return LAYOUTS.includes(value) ? value : DEFAULTS.layout;
  }

  // Bare `data-layout-switcher` is the normal way to ask for it, and that
  // arrives as an empty string rather than a value - so presence alone counts,
  // and only an explicit off word turns it back off. A comma-separated list
  // narrows the row to those layouts, in that order, for a page that wants to
  // offer a reader two shapes without putting a third in front of them.
  // Returns false or a layout list, never a bare true, so the caller has the
  // pills to render rather than having to reach for LAYOUTS itself.
  function parseLayoutSwitcher(rawValue) {
    if (rawValue === undefined) {
      return DEFAULTS.layoutSwitcher;
    }

    const value = String(rawValue).trim().toLowerCase();

    if (value === 'false' || value === '0' || value === 'off' || value === 'no') {
      return false;
    }

    const requested = parseLayoutList(value);

    // Bare attribute, or nothing in it the embed renders, means offer them all
    // - a typo should not quietly strip the row down to one button.
    return requested.length ? requested : LAYOUTS.slice();
  }

  function parseLayoutList(rawValue) {
    const seen = new Set();
    const resolved = [];

    String(rawValue)
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .forEach((entry) => {
        if (LAYOUTS.includes(entry) && !seen.has(entry)) {
          seen.add(entry);
          resolved.push(entry);
        }
      });

    return resolved;
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
      <div class="vq-feed-list is-${escapeAttribute(config.layout)}">
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

  // One template per content type, not one template with fields suppressed. An
  // event has seats, a time and a cost; a For Sale listing has an asking price
  // and no registration at all; a Business Listing has neither and is really a
  // directory entry. Running all three through the event treatment is what put
  // "Date TBD" rows and a "0 Waitlisted" pill on a sewing machine.
  //
  // `data-template` and the layout class on .vq-feed-list are independent: the
  // template decides which blocks a card contains, the layout decides how the
  // media and body sit together, so each of the four pages picks its own.
  function buildCardMarkup(event, config) {
    const template = getCardTemplate(event);
    const title = event.title || 'Listing';
    const media = buildThumbnailMarkup(getEventImages(event), title, event.placeholderImageUrl);
    const body = template === 'business'
      ? buildBusinessCardBody(event, config)
      : template === 'forsale'
        ? buildForSaleCardBody(event, config)
        : buildEventCardBody(event, config);

    return `
      <article class="vq-feed-card" data-template="${template}" data-event-type="${escapeAttribute(event.eventType)}">
        <div class="vq-feed-media">${media}</div>
        <div class="vq-feed-body">${body}</div>
      </article>
    `;
  }

  function getCardTemplate(event) {
    if (event.eventType === 'Business Listing') {
      return 'business';
    }

    if (event.eventType === 'For Sale') {
      return 'forsale';
    }

    return 'event';
  }

  // Pills, then the stacked date, then the title. A card with no date concept
  // passes an empty dateBlock and the block is simply absent - under the old
  // inline date line an absent date had to be propped open with a min-height
  // so neighbouring titles stayed aligned, which a stacked block beside the
  // heading does not need.
  function buildCardHeadMarkup({ dateBlock, pills, title }) {
    return `
      <div class="vq-feed-card-head">
        ${dateBlock}
        <div class="vq-feed-heading">
          <div class="vq-feed-pill-row">${pills}</div>
          <h3>${escapeHtml(title)}</h3>
        </div>
      </div>
    `;
  }

  function buildDescriptionMarkup(description) {
    if (!description) {
      return '';
    }

    const isLong = description.length > DESCRIPTION_PREVIEW_LENGTH;
    const preview = isLong
      ? `${description.slice(0, DESCRIPTION_PREVIEW_LENGTH).trim()}...`
      : description;

    return `
      <div class="vq-feed-description">
        <p data-role="preview">${escapeHtml(preview)}</p>
        ${isLong ? `<p class="is-hidden" data-role="full">${escapeHtml(description)}</p>` : ''}
        ${isLong ? '<button class="vq-feed-text-button" data-action="toggle-description" type="button">Show Full Description</button>' : ''}
      </div>
    `;
  }

  function buildEventCardBody(event, config) {
    // A challenge runs over a season rather than on a day, so it gets no date
    // block at all - not an empty one.
    const isChallenge = event.eventType === 'Challenges';
    const availabilityLabel = event.registrationAvailability || getRegistrationAvailability(event).label;
    const availabilityTone = availabilityLabel === 'Unlimited'
      ? 'is-open'
      : event.registrationIsFull
        ? 'is-waitlist'
        : event.registrationOpen
          ? 'is-open'
          : 'is-closed';
    const presenterLabel = event.presenter || event.contactName || event.ownerName || '';
    // A Lecture takes no registrations, and neither does a Workshop set to
    // None. Seats, availability, an open/closed pill and the registration dates
    // are all answers to a question nobody asked of those - and "Registration
    // Closed" in particular reads as though it had once been open and been
    // missed. Older feed responses predate the field, so an absent value falls
    // back to the previous behaviour rather than blanking every card.
    const takesRegistrations = event.takesRegistrations !== false;
    const pills = `
      <span class="vq-feed-type">${escapeHtml(event.eventType)}</span>
      ${takesRegistrations ? `
        <span class="vq-feed-status-pill ${availabilityTone}">${escapeHtml(availabilityLabel)}</span>
        <span class="vq-feed-status-pill ${event.registrationOpen ? 'is-open' : 'is-closed'}">${event.registrationOpen ? 'Registration Open' : 'Registration Closed'}</span>
      ` : ''}
    `;

    return `
      ${buildCardHeadMarkup({
        dateBlock: isChallenge ? '' : buildDateStackMarkup(event.date),
        pills,
        title: event.title || 'Event'
      })}
      ${buildDescriptionMarkup(event.description || '')}
      ${takesRegistrations ? buildSeatMeterMarkup(event) : ''}
      <dl class="vq-feed-meta">
        ${hasDateRange(event) ? `<div><dt>Dates</dt><dd>${escapeHtml(formatEventDateRange(event))}</dd></div>` : ''}
        ${isChallenge ? '' : `<div><dt>Time</dt><dd>${escapeHtml(formatTimeRange(event.startTime, event.endTime))}</dd></div>`}
        ${takesRegistrations && (event.registrationOpenAt || event.registrationCloseAt) ? `<div><dt>Registration Open/Closes</dt><dd>${escapeHtml(formatRegistrationDateRange(event))}</dd></div>` : ''}
        ${presenterLabel ? `<div><dt>Presenter</dt><dd>${escapeHtml(presenterLabel)}</dd></div>` : ''}
        ${event.location ? `<div><dt>Location</dt><dd>${escapeHtml(event.location)}</dd></div>` : ''}
      </dl>
      <dl class="vq-feed-meta vq-feed-cost">
        <div class="vq-feed-payment-detail">
          <dt>Cost</dt>
          <dd>${getPaymentDetails(event)}</dd>
        </div>
      </dl>
      ${buildCoordinatorContactMarkup(event)}
      ${buildActionsMarkup([
        ...buildDocumentLinks(event, config),
        event.registrationOpen || getExternalRegistrationUrl(event)
          ? buildRegisterLink(event, config)
          : ''
      ])}
    `;
  }

  // A directory entry: no date, no seats, no cost. The business name is
  // already the card title (getListingTitle in shared/eventListing.js sets it),
  // so the Business row would only repeat it - the specialty leads instead,
  // and the contact fields become a tappable block rather than a definition
  // grid competing with event metadata.
  function buildBusinessCardBody(event, config) {
    const details = getListingDetails(event);
    const specialty = extractDetail(details, 'Specialty');
    extractDetail(details, 'Business');

    return `
      ${buildCardHeadMarkup({
        dateBlock: '',
        // The business type leads the pill row. On a page showing nothing but
        // business listings the "Business Listing" pill is identical on every
        // card, so the group is the only part of that row worth scanning.
        pills: `
          ${event.businessTypeLabel ? `<span class="vq-feed-business-type">${escapeHtml(event.businessTypeLabel)}</span>` : ''}
          <span class="vq-feed-type">${escapeHtml(event.eventType)}</span>
          ${specialty ? `<span class="vq-feed-specialty">${escapeHtml(specialty.value)}</span>` : ''}
        `,
        title: event.title || 'Business Listing'
      })}
      ${buildDescriptionMarkup(event.description || '')}
      ${buildListingContactMarkup(details)}
      ${buildActionsMarkup(buildDocumentLinks(event, config))}
    `;
  }

  // A classified. The asking price is the whole reason someone reads the card,
  // so it leads at display size instead of sitting as the first row of a
  // definition list weighted the same as "Posting Ends".
  function buildForSaleCardBody(event, config) {
    const details = getListingDetails(event);
    const price = extractDetail(details, 'Asking Price');
    const postingEnds = extractDetail(details, 'Posting Ends');

    return `
      ${buildCardHeadMarkup({
        dateBlock: '',
        pills: `<span class="vq-feed-type">${escapeHtml(event.eventType)}</span>`,
        title: event.title || 'For Sale Listing'
      })}
      ${price ? `<p class="vq-feed-price">${escapeHtml(price.value)}</p>` : ''}
      ${buildDescriptionMarkup(event.description || '')}
      ${buildListingContactMarkup(details)}
      ${postingEnds ? `<p class="vq-feed-posting-ends">Listed until ${escapeHtml(postingEnds.value)}</p>` : ''}
      ${buildActionsMarkup(buildDocumentLinks(event, config))}
    `;
  }

  // Which fields a listing has, and the "TBD" text when one is empty, stay
  // defined once in shared/eventListing.js and arrive serialized on the
  // payload - this file only decides where each lands. That split is
  // deliberate: the embed is a standalone IIFE and cannot import shared/, and
  // every helper it has re-implemented instead has eventually drifted from the
  // app it mirrors.
  function getListingDetails(event) {
    return Array.isArray(event.listingDetails) ? event.listingDetails.slice() : [];
  }

  // Removes the entry so whatever is left can be rendered as the remainder,
  // which is how each template promotes its own hero fields without having to
  // re-list the ones it did not want.
  function extractDetail(details, label) {
    const index = details.findIndex((detail) => detail && detail.label === label);
    return index === -1 ? null : details.splice(index, 1)[0];
  }

  function buildListingContactMarkup(details) {
    if (!details.length) {
      return '';
    }

    return `
      <dl class="vq-feed-contact">
        ${details
          .map((detail) => {
            const value = String(detail.value == null ? '' : detail.value);
            const safeValue = escapeHtml(value);
            // A website arrives with its scheme already normalized on
            // detail.href, since the embed cannot import the shared helper
            // that does it - value is the bare host, for display.
            const rendered = detail.link === 'email'
              ? `<a href="mailto:${escapeAttribute(value)}">${safeValue}</a>`
              : detail.link === 'phone'
                ? `<a href="tel:${escapeAttribute(value.replace(/[^0-9+]/g, ''))}">${safeValue}</a>`
                : detail.link === 'website' && detail.href
                  ? `<a href="${escapeAttribute(detail.href)}" target="_blank" rel="noopener noreferrer">${safeValue}</a>`
                  : safeValue;

            return `<div><dt>${escapeHtml(detail.label || '')}</dt><dd>${rendered}</dd></div>`;
          })
          .join('')}
      </dl>
    `;
  }

  function buildActionsMarkup(links) {
    const rendered = links.filter(Boolean).join('');
    return rendered ? `<div class="vq-feed-actions">${rendered}</div>` : '';
  }

  // Gated purely on the file being there, never on event type - every template
  // calls this, so whatever has a PDF attached shows the link. The feed
  // serializes supplyListUrl for every listing regardless of type, so a type
  // check here would only re-hide a file someone had deliberately uploaded.
  // An event can carry more than one PDF - a Challenge has a Challenge PDF and
  // a separate supply list - so this returns a link per document. The feed
  // resolves them into `documents` with their viewer URLs already built;
  // supplyListUrl is the fallback for a feed response that predates that.
  function buildDocumentLinks(event, config) {
    const documents = Array.isArray(event.documents) && event.documents.length
      ? event.documents
      : event.supplyListUrl
        ? [{
          kind: 'supply-list',
          title: event.supplyListTitle || 'Supply List PDF',
          viewerUrl: event.supplyListViewerUrl || buildSupplyListViewerUrl(config.sourceUrl, event.id)
        }]
        : [];

    return documents.map((eventDocument) => {
      const viewerUrl = eventDocument.viewerUrl
        || buildDocumentViewerUrl(config.sourceUrl, event.id, eventDocument.kind);

      return `<a class="vq-feed-secondary" href="${escapeAttribute(viewerUrl)}" data-supply-list-url="${escapeAttribute(viewerUrl)}">View/Download ${escapeHtml(eventDocument.title || 'PDF')}</a>`;
    });
  }

  function buildRegisterLink(event, config) {
    // Go-live transition. An event still run by the guild's previous
    // registration system publishes its own address, and Register points there
    // instead of at this app. Remove once no event carries the field.
    const registerUrl = getExternalRegistrationUrl(event)
      || buildRegistrationUrl(config.sourceUrl, event);

    return registerUrl
      ? `<a class="vq-feed-primary vq-feed-register-action" href="${escapeAttribute(registerUrl)}" target="_blank" rel="noopener noreferrer">${event.registrationIsFull ? 'Join Waitlist' : 'Register'}</a>`
      : '';
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

  function getExternalRegistrationUrl(event) {
    const value = String(event.externalRegistrationUrl || '').trim();

    return /^https?:\/\/\S+$/i.test(value) ? value : '';
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

  // The hard requirement on the event card: capacity, registered and open
  // seats are always visible here. Guild members plan around exactly those
  // three, so they are never folded behind a detail view. Pending Payment and
  // Waitlisted join them only when non-zero, which is what clears the noise
  // from the old always-five-pill row without dropping data anyone needs.
  function buildSeatMeterMarkup(event) {
    const registered = Number(event.registeredCount || 0);
    const pendingPayment = Number(event.pendingPaymentCount || 0);
    const waitlisted = Number(event.waitlistedCount || 0);
    const held = Number(event.heldCount || 0);
    const capacity = Number(event.capacity || 0);
    const figures = [];

    if (event.capacityUnlimited) {
      figures.push({ label: 'capacity', value: 'Unlimited' });
      figures.push({ label: 'registered', value: String(registered) });
    } else {
      const open = capacity ? Math.max(capacity - registered - pendingPayment - held, 0) : null;

      figures.push({ label: 'capacity', value: capacity ? String(capacity) : 'Not set' });
      figures.push({ label: 'registered', value: String(registered) });
      figures.push({
        label: open === 0 ? 'open - waitlist available' : 'open',
        tone: open === 0 ? 'waitlist' : 'open',
        value: open === null ? 'N/A' : String(open)
      });
    }

    if (pendingPayment) {
      figures.push({ label: 'pending payment', tone: 'waitlist', value: String(pendingPayment) });
    }

    if (waitlisted) {
      figures.push({ label: 'waitlisted', tone: 'waitlist', value: String(waitlisted) });
    }

    return `
      <div class="vq-feed-seats" aria-label="Registration statistics">
        ${buildSeatSegmentsMarkup(event, capacity, registered, pendingPayment + held)}
        <p class="vq-feed-seat-figures">
          ${figures
            .map((figure) => `<span${figure.tone ? ` class="is-${figure.tone}"` : ''}><strong>${escapeHtml(figure.value)}</strong> ${escapeHtml(figure.label)}</span>`)
            .join('')}
        </p>
      </div>
    `;
  }

  // One segment per seat is the point of the meter - the reader counts what is
  // left rather than decoding a percentage, and the pieced row of squares is
  // the app's own quilt-block motif. Past SEAT_METER_MAX_SEGMENTS the squares
  // are too thin to count, so it degrades to a proportional bar; the figures
  // line carries the exact numbers either way.
  function buildSeatSegmentsMarkup(event, capacity, registered, pending) {
    if (event.capacityUnlimited || !capacity) {
      return '';
    }

    if (capacity > SEAT_METER_MAX_SEGMENTS) {
      const takenPercent = Math.min(Math.round(((registered + pending) / capacity) * 100), 100);
      const registeredPercent = Math.min(Math.round((registered / capacity) * 100), 100);

      return `
        <div class="vq-feed-seat-bar" role="presentation">
          <span class="vq-feed-seat-bar-pending" style="width: ${takenPercent}%"></span>
          <span class="vq-feed-seat-bar-fill" style="width: ${registeredPercent}%"></span>
        </div>
      `;
    }

    const segments = [];

    for (let index = 0; index < capacity; index += 1) {
      const tone = index < registered
        ? ' is-filled'
        : index < registered + pending
          ? ' is-pending'
          : '';

      segments.push(`<span class="vq-feed-seat${tone}"></span>`);
    }

    return `<div class="vq-feed-seat-meter" role="presentation">${segments.join('')}</div>`;
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
      ${buildLayoutSwitcherMarkup(config)}
      <div class="vq-feed-root"></div>
    `;
    wireViewPills(container, config);
    wireLayoutSwitcher(container, config);
  }

  // Off unless a page asks for it. It is a chooser for whoever is setting the
  // page up, not something every visitor needs - drop the attribute once a
  // layout is settled and the feed renders that one with no controls.
  function buildLayoutSwitcherMarkup(config) {
    const layouts = config.layoutSwitcher || [];

    // One button is not a choice, so it renders nothing - matching the view
    // pills, which a single category hides the same way.
    if (layouts.length < 2) {
      return '';
    }

    return `
      <div class="vq-feed-layout-controls" role="group" aria-label="Card layout">
        <span class="vq-feed-layout-label">Layout</span>
        ${layouts.map((layout) => {
          const isActive = layout === config.layout;

          return `<button aria-pressed="${isActive}" class="vq-feed-layout${isActive ? ' is-active' : ''}" data-layout="${escapeAttribute(layout)}" type="button">${escapeHtml(LAYOUT_LABELS[layout])}</button>`;
        }).join('')}
      </div>
    `;
  }

  function wireLayoutSwitcher(container, config) {
    const buttons = Array.from(container.querySelectorAll('.vq-feed-layout'));

    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        const nextLayout = parseLayout(button.dataset.layout);

        if (nextLayout === config.layout) {
          return;
        }

        // Recorded on the config rather than only swapped on the list that is
        // on screen: switching category pills re-renders the list from
        // scratch, and a layout held in the DOM alone would silently snap back
        // to the default at that moment.
        config.layout = nextLayout;
        buttons.forEach((item) => {
          const isActive = item === button;
          item.classList.toggle('is-active', isActive);
          item.setAttribute('aria-pressed', String(isActive));
        });

        applyLayout(container, config);
      });
    });
  }

  // Layout is pure CSS on the list, so changing it is a class swap - no
  // refetch, and no re-render of the cards themselves.
  function applyLayout(container, config) {
    const list = container.querySelector('.vq-feed-list');

    if (!list) {
      return;
    }

    LAYOUTS.forEach((layout) => list.classList.toggle(`is-${layout}`, layout === config.layout));
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
      .vq-feed-layout-controls {
        align-items: center;
        border-bottom: 1px solid #ded5ca;
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        margin: 0 0 18px;
        padding: 0 0 16px;
      }
      /* Only one of the two control rows carries the rule above the feed. */
      .vq-feed-controls:has(+ .vq-feed-layout-controls) {
        border-bottom: 0;
        margin-bottom: 10px;
        padding-bottom: 0;
      }
      .vq-feed-layout-label {
        color: #5a6b67;
        font-size: 0.86rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        margin-right: 2px;
        text-transform: uppercase;
      }
      /* Deliberately the same pill as the category row - two differently
         styled control rows stacked on one page read as a mistake. */
      .vq-feed-layout {
        appearance: none;
        background: #ffffff;
        border: 1px solid #c8d4d0;
        border-radius: 999px;
        color: #1d2927;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
        padding: 8px 14px;
      }
      .vq-feed-layout:hover {
        border-color: #225c56;
      }
      .vq-feed-layout.is-active {
        background: #225c56;
        border-color: #225c56;
        color: #ffffff;
      }
      /* All three layouts render the same media + body pair; only the geometry
         differs, and these two custom properties carry it into the shared
         thumbnail markup so the photo resizes without a second set of rules
         per layout. */
      .vq-feed-list {
        --vq-media-width: 260px;
        --vq-media-height: 190px;
        display: grid;
        gap: 18px;
      }
      .vq-feed-list.is-grid {
        --vq-media-width: 100%;
        /* Matches the stacked height the container query below applies, so a
           tile does not change photo height as the column crosses 440px. */
        --vq-media-height: 200px;
        grid-template-columns: repeat(auto-fill, minmax(285px, 1fr));
      }
      .vq-feed-list.is-agenda {
        --vq-media-width: 88px;
        --vq-media-height: 88px;
        gap: 0;
      }
      .vq-feed-card {
        background: #ffffff;
        border: 1px solid #ded5ca;
        border-radius: 10px;
        box-shadow: 0 10px 24px rgba(29, 41, 39, 0.06);
        /* Every card is its own query container. The embed sits in a GoDaddy
           HTML block inside a column of unpredictable width, so a card has to
           respond to the space it actually got - a viewport-keyed rule reports
           the browser window instead, which is how a layout bug here stayed
           invisible until someone sent a screen recording. */
        container-type: inline-size;
        display: flex;
        /* Without this the media column stretches to the full card height, so
           a short photo sits in a tall invisible box that swallows clicks
           meant for the text beside it. */
        align-items: flex-start;
        flex-wrap: wrap;
        gap: 16px;
        padding: 18px;
      }
      .vq-feed-media {
        flex: 0 0 auto;
        width: var(--vq-media-width);
      }
      .vq-feed-body {
        align-content: start;
        display: grid;
        flex: 1 1 220px;
        gap: 8px;
        min-width: 0;
      }
      /* Below this the body has too little room to read beside a photo, so the
         media takes a full line and the body wraps under it. Setting the
         properties on .vq-feed-media rather than the card is deliberate: a
         container query cannot match the element that establishes it. */
      @container (max-width: 440px) {
        .vq-feed-media {
          --vq-media-width: 100%;
          --vq-media-height: 200px;
        }
      }
      .vq-feed-list.is-agenda .vq-feed-card {
        border-radius: 0;
        border-width: 0 0 1px;
        box-shadow: none;
        gap: 14px;
        padding: 14px 2px;
      }
      .vq-feed-list.is-agenda .vq-feed-card:last-child {
        border-bottom-width: 0;
      }
      .vq-feed-card.is-hidden,
      .vq-feed-list.is-hidden,
      .vq-feed-empty.is-hidden,
      .vq-feed-description .is-hidden {
        display: none;
      }
      .vq-feed-card-head {
        align-items: start;
        display: flex;
        gap: 14px;
      }
      .vq-feed-heading {
        display: grid;
        gap: 6px;
        min-width: 0;
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
      /* A calendar tile rather than an inline date line. A card with no date
         concept omits the block entirely and the flex gap closes up, which is
         what retires the old empty-date row propped open with a min-height. */
      .vq-feed-datestack {
        background: #fdf6f2;
        border: 1px solid #e6cdbf;
        border-radius: 8px;
        color: #9a4d2f;
        display: grid;
        flex: 0 0 auto;
        justify-items: center;
        line-height: 1.05;
        padding: 8px 10px;
        text-align: center;
        width: 62px;
      }
      .vq-feed-datestack-month {
        font-size: 0.72rem;
        font-weight: 800;
        letter-spacing: 0.08em;
      }
      .vq-feed-datestack-day {
        font-size: 1.6rem;
        font-weight: 800;
      }
      .vq-feed-datestack-year {
        color: #b07a5f;
        font-size: 0.72rem;
        font-weight: 700;
      }
      .vq-feed-datestack.is-tbd .vq-feed-datestack-day {
        font-size: 1rem;
        padding-top: 5px;
      }
      .vq-feed-card h3 {
        font-size: 1.4rem;
        line-height: 1.2;
        margin: 0;
      }
      .vq-feed-list.is-grid .vq-feed-card h3,
      .vq-feed-list.is-agenda .vq-feed-card h3 {
        font-size: 1.18rem;
      }
      .vq-feed-thumb-stack {
        align-items: flex-start;
        display: grid;
        gap: 6px;
        /* Pinned to the image width. Without this the column sizes to its
           widest child, so the "Click image for larger view" hint made every
           card carrying it wider than one showing just an image, and the text
           beside it correspondingly narrower. */
        width: var(--vq-media-width);
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
        height: var(--vq-media-height);
        object-fit: cover;
        width: var(--vq-media-width);
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
        height: var(--vq-media-height);
        position: relative;
        width: var(--vq-media-width);
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
        /* Centred proportionally rather than at a fixed offset, because the
           media height is now a per-layout custom property. */
        top: 50%;
        transform: translateY(-50%);
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
      /* Cost sits on its own below the meta grid, so it takes one left-aligned
         column instead of stretching across the auto-fit tracks. */
      .vq-feed-cost {
        grid-template-columns: auto;
        justify-items: start;
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
      .vq-feed-seats {
        display: grid;
        gap: 6px;
        margin-top: 4px;
      }
      /* One square per seat, pieced in a row - the quilt-block motif the app
         already uses, and countable in a way a percentage is not. */
      .vq-feed-seat-meter {
        display: flex;
        flex-wrap: wrap;
        gap: 3px;
      }
      .vq-feed-seat {
        background: #ffffff;
        border: 1px solid #c3d3cf;
        border-radius: 2px;
        height: 13px;
        width: 13px;
      }
      .vq-feed-seat.is-filled {
        background: #225c56;
        border-color: #225c56;
      }
      .vq-feed-seat.is-pending {
        background: #e8c76a;
        border-color: #c9a746;
      }
      .vq-feed-seat-bar {
        background: #ffffff;
        border: 1px solid #c3d3cf;
        border-radius: 999px;
        height: 13px;
        overflow: hidden;
        position: relative;
      }
      .vq-feed-seat-bar-pending,
      .vq-feed-seat-bar-fill {
        bottom: 0;
        left: 0;
        position: absolute;
        top: 0;
      }
      .vq-feed-seat-bar-pending {
        background: #e8c76a;
      }
      .vq-feed-seat-bar-fill {
        background: #225c56;
      }
      /* Capacity, registered and open are always here. The meter is the quick
         read; these are the exact numbers, in tabular figures so they stay in
         column as counts change. */
      .vq-feed-seat-figures {
        color: #5a6b67;
        display: flex;
        flex-wrap: wrap;
        font-size: 0.86rem;
        gap: 4px 12px;
        margin: 0;
      }
      .vq-feed-seat-figures strong {
        color: #1d2927;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-variant-numeric: tabular-nums;
      }
      .vq-feed-seat-figures .is-open strong {
        color: #1f6a31;
      }
      .vq-feed-seat-figures .is-waitlist strong {
        color: #8a5a00;
      }
      /* For Sale leads with the price - it is the reason the card gets read. */
      .vq-feed-price {
        color: #225c56;
        font-size: 1.7rem;
        font-weight: 800;
        letter-spacing: -0.01em;
        margin: 0;
      }
      .vq-feed-posting-ends {
        color: #5a6b67;
        font-size: 0.86rem;
        margin: 0;
      }
      /* Filled rather than outlined, unlike every other pill on the card - the
         business group is the one thing that differs between listings on a
         page that is otherwise all the same type. */
      .vq-feed-business-type {
        background: #225c56;
        border: 1px solid #225c56;
        border-radius: 999px;
        color: #ffffff;
        display: inline-flex;
        font-size: 0.82rem;
        font-weight: 800;
        letter-spacing: 0.02em;
        padding: 6px 12px;
      }
      .vq-feed-specialty {
        background: #f7f1e8;
        border: 1px solid #decfbd;
        border-radius: 999px;
        display: inline-flex;
        font-size: 0.82rem;
        font-weight: 700;
        padding: 6px 10px;
      }
      .vq-feed-contact {
        display: grid;
        gap: 10px 18px;
        /* Sized so a full member email fits on one line rather than breaking
           mid-domain. Fewer, wider columns read better here than more, narrower
           ones: these are addresses to be copied, not values to be compared. */
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        margin: 4px 0 0;
      }
      /* A grid item defaults to min-width:auto, which is the width of its
         longest unbreakable word - so an email address widened its own cell
         and ran straight over the next column. */
      .vq-feed-contact div {
        display: grid;
        gap: 2px;
        min-width: 0;
      }
      .vq-feed-contact dt {
        color: #5a6b67;
        font-size: 0.78rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }
      /* An email or a domain has no spaces to wrap at, so it needs explicit
         permission to break mid-string once min-width:0 lets the cell shrink.
         "anywhere" rather than "break-word" so the break counts while the
         track is being sized, not only after it has already overflowed.
         (No backticks in this stylesheet - it is a template literal.) */
      .vq-feed-contact dd {
        margin: 0;
        overflow-wrap: anywhere;
      }
      .vq-feed-contact dd a {
        color: #225c56;
        font-weight: 800;
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
      /* Agenda is a scannable index, not a card: at 88px the carousel chrome
         and photo hints are unreadable, and the long-form blocks below the
         heading are what the reader came past this list to open, not read
         here. It earns its keep once a page carries a dozen-plus listings. */
      .vq-feed-list.is-agenda .vq-feed-carousel-arrow,
      .vq-feed-list.is-agenda .vq-feed-carousel-toggle,
      .vq-feed-list.is-agenda .vq-feed-carousel-dots,
      .vq-feed-list.is-agenda .vq-feed-thumb-hint,
      .vq-feed-list.is-agenda .vq-feed-thumb-count,
      .vq-feed-list.is-agenda .vq-feed-description,
      .vq-feed-list.is-agenda .vq-feed-coordinator {
        display: none;
      }
      .vq-feed-list.is-agenda .vq-feed-datestack {
        background: none;
        border: 0;
        padding: 0;
        width: 52px;
      }
      .vq-feed-list.is-agenda .vq-feed-seat-meter {
        display: none;
      }
    `;

    document.head.appendChild(style);
  }

  function formatEventDate(value) {
    if (!value) {
      return 'Date TBD';
    }

    // Reformatted as plain text, never through Date: an ISO date-only string
    // parses as UTC midnight, which in any timezone behind UTC lands on the
    // previous day. This branch sat unreachable for a while because its digit
    // class was double-escaped, so every event date rendered a day early.
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
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

  // A Retreat runs across days and carries endDate; every other type leaves it
  // empty. The date tile still shows the start - it is what a reader scans for
  // - and the full span goes in a Dates row beside the time.
  function hasDateRange(event) {
    return Boolean(event.endDate) && event.endDate !== event.date;
  }

  function formatEventDateRange(event) {
    if (!event.date) {
      return formatEventDate(event.endDate);
    }

    return `${formatEventDate(event.date)} - ${formatEventDate(event.endDate)}`;
  }

  function buildDateStackMarkup(value) {
    const parts = parseDateParts(value);

    if (!parts) {
      return `
        <div class="vq-feed-datestack is-tbd">
          <span class="vq-feed-datestack-month">Date</span>
          <span class="vq-feed-datestack-day">TBD</span>
        </div>
      `;
    }

    return `
      <div class="vq-feed-datestack">
        <span class="vq-feed-datestack-month">${escapeHtml(parts.month)}</span>
        <span class="vq-feed-datestack-day">${escapeHtml(parts.day)}</span>
        <span class="vq-feed-datestack-year">${escapeHtml(parts.year)}</span>
      </div>
    `;
  }

  // Same plain-text-first discipline as formatEventDate above, and for the same
  // reason: an ISO date-only string read through Date is UTC midnight, which in
  // any timezone behind UTC lands on the day before. Two formatters reading one
  // field is exactly the split that let this feed render every date a day early
  // while the app's own page stayed correct, so they must stay in step.
  function parseDateParts(value) {
    if (!value) {
      return null;
    }

    const isoMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));

    if (isoMatch) {
      const label = MONTH_LABELS[Number(isoMatch[2]) - 1];

      return label
        ? { day: String(Number(isoMatch[3])), month: label, year: isoMatch[1] }
        : null;
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return {
      day: String(parsed.getDate()),
      month: MONTH_LABELS[parsed.getMonth()],
      year: String(parsed.getFullYear())
    };
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

  function buildDocumentViewerUrl(sourceUrl, eventId, kind) {
    const origin = getSourceOrigin(sourceUrl);

    return `${origin}/events/${encodeURIComponent(eventId || '')}/${encodeURIComponent(kind || 'supply-list')}`;
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
      : `<div class="meta-row"><div class="meta-label">${hasDateRange(event) ? 'Dates' : 'Date'}</div><div>${escapeHtml(hasDateRange(event) ? formatEventDateRange(event) : formatEventDate(event.date))}</div></div>`;
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
