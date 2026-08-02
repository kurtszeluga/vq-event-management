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

export function buildListingDetails(event) {
  if (event.eventType === 'Business Listing') {
    return [
      { label: 'Owner', value: event.ownerName || 'Owner TBD' },
      { label: 'Business', value: event.businessName || 'Business TBD' },
      { label: 'Specialty', value: event.specialty || 'Specialty TBD' },
      { label: 'Email', value: event.contactEmail || 'Email TBD', link: event.contactEmail ? 'email' : '' },
      { label: 'Phone', value: event.contactPhone || 'Phone TBD', link: event.contactPhone ? 'phone' : '' },
      { label: 'Address', value: event.address || 'Address TBD' }
    ];
  }

  return [
    { label: 'Asking Price', value: formatCurrency(event.askingPrice) },
    { label: 'Contact', value: event.contactName || 'Contact TBD' },
    { label: 'Email', value: event.contactEmail || 'Email TBD', link: event.contactEmail ? 'email' : '' },
    { label: 'Phone', value: event.contactPhone || 'Phone TBD', link: event.contactPhone ? 'phone' : '' },
    { label: 'Posting Ends', value: formatListingDateTime(event.visibleUntil) }
  ];
}
