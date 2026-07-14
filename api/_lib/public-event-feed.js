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
    .filter((event) => matchesCategory(event, config))
    .map((event) => serializeEvent(event, origin));

  return {
    category: feedCategory,
    categoryLabel: config.label,
    generatedAt: new Date().toISOString(),
    supportsTypeFilters: config.supportsTypeFilters,
    typeCounts: config.supportsTypeFilters ? buildTypeCounts(events) : {},
    total: events.length,
    events
  };
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

function serializeEvent(event, origin) {
  const eventType = getEventTypeLabel(event);
  const safeOrigin = origin.replace(/\/$/, '');
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
    registrationOpen: Boolean(event.registrationOpen),
    visibleFrom: event.visibleFrom || '',
    visibleUntil: event.visibleUntil || '',
    imageUrl: Array.isArray(event.imageUrls) ? event.imageUrls.find(Boolean) || '' : '',
    supplyListFileName: event.supplyListFileName || '',
    supplyListTitle: event.supplyListTitle || event.supplyListFileName || '',
    supplyListUrl: event.supplyListUrl || '',
    supplyListViewerUrl: event.supplyListUrl ? `${safeOrigin}/events/${event.id}/supply-list` : '',
    detailUrl: `${safeOrigin}/events/${event.id}`,
    registerUrl: event.registrationOpen ? `${safeOrigin}/register?eventId=${event.id}` : '',
    printUrl: `${safeOrigin}/events/${event.id}/print`
  };
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
