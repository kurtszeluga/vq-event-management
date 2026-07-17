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
  const coordinatorAssignments = await loadCoordinatorAssignments(db);
  const serializedEvents = events.map((event) =>
    serializeEvent(event, origin, registrationCounts[event.id], coordinatorAssignments)
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

async function loadCoordinatorAssignments(db) {
  const snapshot = await db.collection('coordinatorAssignments').get();

  return snapshot.docs
    .map((docSnapshot) => ({ id: docSnapshot.id, ...docSnapshot.data() }))
    .filter((assignment) => assignment.isActive !== false);
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

function serializeEvent(event, origin, registrationCounts = {}, coordinatorAssignments = []) {
  const eventType = getEventTypeLabel(event);
  const safeOrigin = origin.replace(/\/$/, '');
  const availability = getAvailability(event, registrationCounts);
  const coordinatorContact = getCoordinatorContact(eventType, coordinatorAssignments);

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
    coordinatorEmail: coordinatorContact.email,
    coordinatorName: coordinatorContact.name,
    location: event.location || '',
    address: event.address || '',
    askingPrice: Number(event.askingPrice || 0),
    allowCashCheckPayment: Boolean(event.allowCashCheckPayment),
    isPaid: Boolean(event.isPaid),
    cost: Number(event.cost || 0),
    serviceFee: Number(event.serviceFee || 0),
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
    supplyListDownloadUrl: event.supplyListUrl
      ? buildFileProxyUrl(safeOrigin, event.supplyListUrl, event.supplyListFileName || event.supplyListTitle || 'supply-list.pdf', 'attachment')
      : '',
    supplyListViewerUrl: event.supplyListUrl
      ? `${safeOrigin}/events/${event.id}/supply-list`
      : '',
    detailUrl: `${safeOrigin}/events/${event.id}`,
    registerUrl: event.registrationOpen ? `${safeOrigin}/register?eventId=${event.id}` : '',
    printUrl: `${safeOrigin}/events/${event.id}/print`
  };
}

function getCoordinatorContact(eventType, coordinatorAssignments) {
  const areaId = getCoordinatorAreaId(eventType);
  const assignment = coordinatorAssignments.find((item) => item.coordinatorAreaId === areaId);

  if (!assignment) {
    return {
      email: '',
      name: ''
    };
  }

  return {
    email: assignment.contactEmailOverride || assignment.assignedUserEmail || '',
    name: assignment.assignedUserName || ''
  };
}

function getCoordinatorAreaId(eventType) {
  if ([
    'Class (Half Day)',
    'Class (Full Day)',
    'Class (Half-Day)',
    'Class (Full-Day)',
    'Lecture',
    'Retreat'
  ].includes(eventType)) {
    return 'programs';
  }

  if (eventType === 'Workshop') {
    return 'workshops';
  }

  if (eventType === 'Challenges') {
    return 'challenges';
  }

  if (eventType === 'Business Listing') {
    return 'business-listings';
  }

  if (eventType === 'For Sale') {
    return 'for-sale';
  }

  return '';
}

function buildFileProxyUrl(origin, fileUrl, fileName, disposition = 'inline') {
  const params = new URLSearchParams({
    disposition,
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
