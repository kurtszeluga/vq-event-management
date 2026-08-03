// Field definitions for Business Listing and For Sale cards.
//
// Three surfaces render these: the public listing pages, the admin list, and
// the GoDaddy embed. The first two import buildListingDetails directly (via
// src/utils/eventFormat.js, which re-exports it); the embed is a standalone
// script with no module system, so the feed API serializes the result into
// its payload instead. Keeping the definitions here is what stops the three
// from drifting apart the way the admin list once had.

export const LISTING_EVENT_TYPES = ['Business Listing', 'For Sale'];

export function isListingEventType(eventType) {
  return LISTING_EVENT_TYPES.includes(eventType);
}

export function getListingTitle(event) {
  if (event.eventType === 'Business Listing') {
    return event.businessName || event.title || 'Business Listing';
  }

  return event.title || 'For Sale Listing';
}

export function formatCurrency(value) {
  const numberValue = Number(value || 0);
  return new Intl.NumberFormat('en-US', {
    currency: 'USD',
    style: 'currency'
  }).format(numberValue);
}

export function formatListingDateTime(value) {
  if (!value) {
    return 'TBD';
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
}

// Members type "villagequilters.com" far more often than a full URL, and a
// bare host in an href resolves as a path relative to the current page - so
// the stored value is left exactly as entered and the scheme is added here,
// at the point it becomes a link.
export function normalizeWebsiteUrl(value) {
  const trimmed = String(value || '').trim();

  if (!trimmed) {
    return '';
  }

  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// The scheme is noise on a card; the host is what a reader recognises.
export function formatWebsiteLabel(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/, '');
}

export function buildListingDetails(event) {
  if (event.eventType === 'Business Listing') {
    const details = [
      { label: 'Owner', value: event.ownerName || 'Owner TBD' },
      { label: 'Business', value: event.businessName || 'Business TBD' }
    ];

    // Specialty and Website are both optional - not every member has one to
    // name. An absent optional field drops its row entirely rather than
    // printing "Specialty TBD", which would otherwise appear on every listing
    // that legitimately has none.
    if (event.specialty) {
      details.push({ label: 'Specialty', value: event.specialty });
    }

    details.push(
      { label: 'Email', value: event.contactEmail || 'Email TBD', link: event.contactEmail ? 'email' : '' },
      { label: 'Phone', value: event.contactPhone || 'Phone TBD', link: event.contactPhone ? 'phone' : '' }
    );

    if (event.website) {
      details.push({
        href: normalizeWebsiteUrl(event.website),
        label: 'Website',
        link: 'website',
        value: formatWebsiteLabel(event.website)
      });
    }

    details.push({ label: 'Address', value: event.address || 'Address TBD' });

    return details;
  }

  return [
    { label: 'Asking Price', value: formatCurrency(event.askingPrice) },
    { label: 'Contact', value: event.contactName || 'Contact TBD' },
    { label: 'Email', value: event.contactEmail || 'Email TBD', link: event.contactEmail ? 'email' : '' },
    { label: 'Phone', value: event.contactPhone || 'Phone TBD', link: event.contactPhone ? 'phone' : '' },
    { label: 'Posting Ends', value: formatListingDateTime(event.visibleUntil) }
  ];
}
