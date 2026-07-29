export const MAX_EVENT_IMAGES = 4;

// Shown in place of an uploaded photo, on both the site (src/data/eventOptions.js
// re-exports this) and the GoDaddy embed feed (api/_lib/public-event-feed.js
// publishes an absolute URL built from this map). Business Listing and For
// Sale are intentionally excluded - those keep the plain empty state.
// Regenerate images with scripts/generateEventPlaceholderImages.mjs.
export const EVENT_TYPE_PLACEHOLDER_IMAGES = {
  'Class (Half Day)': '/assets/event-placeholders/class-half-day.svg',
  'Class (Full Day)': '/assets/event-placeholders/class-full-day.svg',
  Workshop: '/assets/event-placeholders/workshop.svg',
  Retreat: '/assets/event-placeholders/retreat.svg',
  Lecture: '/assets/event-placeholders/lecture.svg',
  Challenges: '/assets/event-placeholders/challenges.svg',
  Other: '/assets/event-placeholders/other.svg'
};

export function getEventPlaceholderImage(eventType) {
  return EVENT_TYPE_PLACEHOLDER_IMAGES[eventType] || null;
}
