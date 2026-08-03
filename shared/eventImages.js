export const MAX_EVENT_IMAGES = 4;

// Shown in place of an uploaded photo, on both the site (src/data/eventOptions.js
// re-exports this) and the GoDaddy embed feed (api/_lib/public-event-feed.js
// publishes an absolute URL built from this map). For Sale is intentionally
// excluded - a for-sale item is nearly always photographed, and a decorative
// stand-in would misrepresent what is actually being sold.
// Regenerate images with scripts/generateEventPlaceholderImages.mjs.
export const EVENT_TYPE_PLACEHOLDER_IMAGES = {
  'Class (Half Day)': '/assets/event-placeholders/class-half-day.svg',
  'Class (Full Day)': '/assets/event-placeholders/class-full-day.svg',
  Workshop: '/assets/event-placeholders/workshop.svg',
  Retreat: '/assets/event-placeholders/retreat.svg',
  Lecture: '/assets/event-placeholders/lecture.svg',
  Challenges: '/assets/event-placeholders/challenges.svg',
  Other: '/assets/event-placeholders/other.svg',
  'Business Listing': '/assets/event-placeholders/business-listing.svg'
};

// Business listings key off their group rather than their event type, so a
// directory page is scannable by group before anyone uploads a photo. Keys are
// the `value` of the built-in BUSINESS_TYPES; a type configured beyond those
// has no image of its own and falls back to the generic Business Listing block.
export const BUSINESS_TYPE_PLACEHOLDER_IMAGES = {
  'longarm-quilters': '/assets/event-placeholders/business-longarm-quilters.svg',
  'quilt-patterns': '/assets/event-placeholders/business-quilt-patterns.svg',
  'retreat-facilities': '/assets/event-placeholders/business-retreat-facilities.svg'
};

// businessType is optional and second so every existing single-argument caller
// keeps working unchanged.
export function getEventPlaceholderImage(eventType, businessType) {
  if (businessType && BUSINESS_TYPE_PLACEHOLDER_IMAGES[businessType]) {
    return BUSINESS_TYPE_PLACEHOLDER_IMAGES[businessType];
  }

  return EVENT_TYPE_PLACEHOLDER_IMAGES[eventType] || null;
}
