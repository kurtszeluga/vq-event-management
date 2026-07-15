import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const EVENT_CATEGORY_CONFIG = {
  business: {
    allowedTypes: ['Business Listing'],
    label: 'Business Listings',
    supportsTypeFilters: false
  },
  challenges: {
    allowedTypes: ['Challenges'],
    label: 'Challenges',
    supportsTypeFilters: false
  },
  events: {
    excludedTypes: ['Business Listing', 'For Sale', 'Challenges'],
    label: 'Events',
    supportsTypeFilters: true
  },
  forsale: {
    allowedTypes: ['For Sale'],
    label: 'For Sale',
    supportsTypeFilters: false
  }
};

let firebaseProjectId = '';

export function initializeAdminApp() {
  const existingApp = getApps()[0];

  if (existingApp) {
    firebaseProjectId = existingApp.options.projectId || firebaseProjectId;
    return existingApp;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  const serviceAccount = JSON.parse(serviceAccountJson);
  firebaseProjectId = serviceAccount.project_id;

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: firebaseProjectId
  });
}

export function getFeedCategory(value) {
  const normalized = String(value || 'events').toLowerCase();
  return EVENT_CATEGORY_CONFIG[normalized] ? normalized : 'events';
}

export async function loadPublicFeed(category, origin) {
  initializeAdminApp();

  const db = getFirestore();
  const feedCategory = getFeedCategory(category);
  const config = EVENT_CATEGORY_CONFIG[feedCategory];
  const snapshot = await db
    .collection('events')
    .where('status', '==', 'Published')
    .orderBy('date', 'asc')
    .get();

  const events = snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .filter(isEventVisible)
    .filter((event) => matchesCategory(event, config));
  const registrationCounts = await loadRegistrationCounts(db, events.map((event) => event.id));
  const serializedEvents = events.map((event) =>
    serializeEvent(event, origin, registrationCounts[event.id])
  );

  return {
    category: feedCategory,
    categoryLabel: config.label,
    generatedAt: new Date().toISOString(),
    supportsTypeFilters: config.supportsTypeFilters,
    typeCounts: config.supportsTypeFilters ? buildTypeCounts(serializedEvents) : {},
    total: serializedEvents.length,
    events: serializedEvents
  };
}

export async function loadRegistrationCounts(db, eventIds = []) {
  const targetEventIds = new Set(eventIds.filter(Boolean));

  if (!targetEventIds.size) {
    return {};
  }

  const counts = Object.fromEntries(
    [...targetEventIds].map((eventId) => [
      eventId,
      { registered: 0, waitlisted: 0 }
    ])
  );
  const snapshot = await db.collection('registrations').get();

  snapshot.docs.forEach((docSnapshot) => {
    const registration = docSnapshot.data();

    if (!targetEventIds.has(registration.eventId)) {
      return;
    }

    if (registration.status === 'Registered') {
      counts[registration.eventId].registered += 1;
    } else if (registration.status === 'Waitlisted') {
      counts[registration.eventId].waitlisted += 1;
    }
  });

  return counts;
}

function matchesCategory(event, config) {
  const eventType = getEventTypeLabel(event);

  if (config.allowedTypes) {
    return config.allowedTypes.includes(eventType);
  }

  if (config.excludedTypes) {
    return !config.excludedTypes.includes(eventType);
  }

  return true;
}

function serializeEvent(event, origin, registrationCounts = {}) {
  const eventType = getEventTypeLabel(event);
  const safeOrigin = origin.replace(/\/$/, '');
  const availability = getAvailability(event, registrationCounts);

  return {
    id: event.id,
    eventType,
    title: event.title || event.businessName || eventType,
    description: event.description || '',
    date: event.date || '',
    startTime: event.startTime || '',
    endTime: event.endTime || '',
    presenter: event.presenter || '',
    ownerName: event.ownerName || '',
    businessName: event.businessName || '',
    specialty: event.specialty || '',
    contactName: event.contactName || '',
    contactEmail: event.contactEmail || '',
    contactPhone: event.contactPhone || '',
    location: event.location || '',
    address: event.address || '',
    askingPrice: Number(event.askingPrice || 0),
    isPaid: Boolean(event.isPaid),
    cost: Number(event.cost || 0),
    capacity: Number(event.capacity || 0),
    capacityUnlimited: Boolean(event.capacityUnlimited),
    registrationOpen: Boolean(event.registrationOpen),
    registeredCount: registrationCounts.registered || 0,
    waitlistedCount: registrationCounts.waitlisted || 0,
    registrationAvailability: availability.label,
    registrationIsFull: availability.isFull,
    visibleFrom: event.visibleFrom || '',
    visibleUntil: event.visibleUntil || '',
    imageUrl: Array.isArray(event.imageUrls) ? event.imageUrls.find(Boolean) || '' : '',
    supplyListFileName: event.supplyListFileName || '',
    supplyListTitle: event.supplyListTitle || event.supplyListFileName || '',
    supplyListUrl: event.supplyListUrl || '',
    supplyListProxyUrl: event.supplyListUrl
      ? buildFileProxyUrl(safeOrigin, event.supplyListUrl, event.supplyListFileName || event.supplyListTitle || 'supply-list.pdf')
      : '',
    supplyListViewerUrl: event.supplyListUrl ? `${safeOrigin}/events/${event.id}/supply-list` : '',
    detailUrl: `${safeOrigin}/events/${event.id}`,
    registerUrl: event.registrationOpen ? `${safeOrigin}/register?eventId=${event.id}` : '',
    printUrl: `${safeOrigin}/events/${event.id}/print`
  };
}

function buildFileProxyUrl(origin, fileUrl, fileName) {
  const params = new URLSearchParams({
    disposition: 'inline',
    filename: fileName || 'supply-list.pdf',
    url: fileUrl
  });

  return `${origin}/api/file-proxy?${params.toString()}`;
}

function getAvailability(event, registrationCounts = {}) {
  if (event.capacityUnlimited) {
    return { isFull: false, label: 'Unlimited' };
  }

  const capacity = Number(event.capacity || 0);

  if (!capacity) {
    return { isFull: false, label: 'Seats available' };
  }

  const registeredCount = Number(registrationCounts.registered || 0);

  if (registeredCount >= capacity) {
    return { isFull: true, label: 'Full - waitlist available' };
  }

  return { isFull: false, label: 'Seats available' };
}

function getEventTypeLabel(event) {
  return event.eventType || event.type || 'Other';
}

function isEventVisible(event) {
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

function buildTypeCounts(events) {
  return events.reduce((counts, event) => ({
    ...counts,
    [event.eventType]: (counts[event.eventType] || 0) + 1
  }), {});
}
