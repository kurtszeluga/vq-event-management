import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getEventPlaceholderImage } from '../../shared/eventImages.js';
import { buildListingDetails, getListingTitle, isListingEventType } from '../../shared/eventListing.js';
import { listEventDocuments } from '../../shared/eventDocuments.js';
import { isRegistrationWindowOpen } from '../../shared/registrationWindow.js';

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
      { held: 0, heldExpiresAt: '', pendingPayment: 0, registered: 0, waitlisted: 0 }
    ])
  );
  const [registrationSnapshot, reservationSnapshot] = await Promise.all([
    db.collection('registrations').get(),
    db.collection('registrationReservations').get()
  ]);

  registrationSnapshot.docs.forEach((docSnapshot) => {
    const registration = docSnapshot.data();

    if (!targetEventIds.has(registration.eventId)) {
      return;
    }

    if (registration.status === 'Pending Payment') {
      counts[registration.eventId].pendingPayment += 1;
    } else if (registration.status === 'Registered') {
      counts[registration.eventId].registered += 1;
    } else if (registration.status === 'Waitlisted') {
      counts[registration.eventId].waitlisted += 1;
    }
  });

  const now = Date.now();

  reservationSnapshot.docs.forEach((docSnapshot) => {
    const reservation = docSnapshot.data();
    const expiresAtMillis = getMillis(reservation.expiresAt);

    if (
      !targetEventIds.has(reservation.eventId)
      || reservation.status !== 'Active'
      || expiresAtMillis <= now
    ) {
      return;
    }

    const eventCounts = counts[reservation.eventId];

    eventCounts.held += 1;

    if (!eventCounts.heldExpiresAt || expiresAtMillis < Date.parse(eventCounts.heldExpiresAt)) {
      eventCounts.heldExpiresAt = new Date(expiresAtMillis).toISOString();
    }
  });

  return counts;
}

function getMillis(value) {
  if (!value) {
    return 0;
  }

  if (typeof value.toMillis === 'function') {
    return value.toMillis();
  }

  if (typeof value.toDate === 'function') {
    return value.toDate().getTime();
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
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

export function serializeEvent(event, origin, registrationCounts = {}, coordinatorAssignments = []) {
  const eventType = getEventTypeLabel(event);
  const listing = { ...event, eventType };
  const isListing = isListingEventType(eventType);
  const safeOrigin = origin.replace(/\/$/, '');
  const availability = getAvailability(event, registrationCounts);
  const coordinatorContact = getCoordinatorContact(eventType, coordinatorAssignments);
  const hasRegistrationWindow = ['future', 'now'].includes(event.registrationMode);
  const registrationOpenAt = hasRegistrationWindow
    ? event.registrationOpenAt
      || event.visibleFrom
      || toIsoString(event.createdDate)
      || ''
    : '';
  const registrationCloseAt = hasRegistrationWindow
    ? event.registrationCloseAt || event.date || ''
    : '';

  // Derived from the same two values this payload publishes, so the feed can
  // never advertise a close date it does not honour. Those two carry the
  // display fallbacks above (visibleFrom/createdDate, and the event date as an
  // implicit close), which is a slightly wider window than the raw configured
  // one the server gate enforces; they agree for any event saved through
  // EventForm, which requires both dates explicitly.
  const registrationOpen = isRegistrationWindowOpen({
    eventType: event.eventType,
    registrationMode: event.registrationMode,
    registrationOpenAt,
    registrationCloseAt
  });

  return {
    id: event.id,
    eventType,
    // Listings title off businessName first, matching the public listing
    // pages - the embed used to show the raw event title instead.
    title: isListing ? getListingTitle(listing) : event.title || event.businessName || eventType,
    // The embed is a standalone script that cannot import shared/, so the
    // rendered field list travels with the payload. Empty for real events,
    // which keep the date/time/presenter/payment treatment below.
    isListing,
    listingDetails: isListing ? buildListingDetails(listing) : [],
    description: event.description || '',
    date: event.date || '',
    // Empty for everything except a Retreat, which runs across days. Additive,
    // so an embed that predates this keeps rendering `date` alone.
    endDate: event.endDate || '',
    startTime: event.startTime || '',
    endTime: event.endTime || '',
    presenter: event.presenter || '',
    ownerName: event.ownerName || '',
    businessName: event.businessName || '',
    businessType: event.businessType || '',
    // The display label rides along because businessTypeDefaults is
    // admin-read-only - nothing public can resolve a value into a label.
    businessTypeLabel: event.businessTypeLabel || '',
    specialty: event.specialty || '',
    website: event.website || '',
    contactName: event.contactName || '',
    contactEmail: event.contactEmail || '',
    contactPhone: event.contactPhone || '',
    coordinatorEmail: coordinatorContact.email,
    coordinatorName: coordinatorContact.name,
    location: event.location || '',
    address: event.address || '',
    askingPrice: Number(event.askingPrice || 0),
    allowCashCheckPayment: Boolean(event.allowCashCheckPayment),
    cashCheckOnly: Boolean(event.cashCheckOnly),
    isPaid: Boolean(event.isPaid),
    cost: Number(event.cost || 0),
    serviceFee: Number(event.serviceFee || 0),
    capacity: Number(event.capacity || 0),
    capacityUnlimited: Boolean(event.capacityUnlimited),
    registrationOpen,
    registrationOpenAt,
    registrationCloseAt,
    registeredCount: registrationCounts.registered || 0,
    pendingPaymentCount: registrationCounts.pendingPayment || 0,
    heldCount: registrationCounts.held || 0,
    heldExpiresAt: registrationCounts.heldExpiresAt || '',
    waitlistedCount: registrationCounts.waitlisted || 0,
    registrationAvailability: availability.label,
    registrationIsFull: availability.isFull,
    visibleFrom: event.visibleFrom || '',
    visibleUntil: event.visibleUntil || '',
    imageUrl: Array.isArray(event.imageUrls) ? event.imageUrls.find(Boolean) || '' : '',
    // GoDaddy's widget only ever rendered the single imageUrl above; these
    // two are additive so its template can show a photo count or the full
    // set later without a breaking change to the feed shape meanwhile.
    imageUrls: Array.isArray(event.imageUrls) ? event.imageUrls.filter(Boolean) : [],
    imageCount: Array.isArray(event.imageUrls) ? event.imageUrls.filter(Boolean).length : 0,
    // Same quilt-block default the site shows for an event with no uploaded
    // photo (empty string for Business Listing/For Sale, which keep the
    // plain empty state) - absolute, since GoDaddy embeds this feed cross-origin.
    placeholderImageUrl: getEventPlaceholderImage(eventType, event.businessType)
      ? `${safeOrigin}${getEventPlaceholderImage(eventType, event.businessType)}`
      : '',
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
    // Every PDF the event carries, with its URLs already resolved. A Challenge
    // has two - a Challenge PDF and a supply list - and the embed cannot
    // import shared/eventDocuments.js to work them out for itself. The
    // supplyList* fields above stay for embeds that predate this.
    documents: listEventDocuments(event).map((eventDocument) => ({
      downloadUrl: buildFileProxyUrl(safeOrigin, eventDocument.url, eventDocument.fileName, 'attachment'),
      fileName: eventDocument.fileName,
      kind: eventDocument.kind,
      proxyUrl: buildFileProxyUrl(safeOrigin, eventDocument.url, eventDocument.fileName),
      title: eventDocument.title,
      viewerUrl: `${safeOrigin}/events/${event.id}/${eventDocument.kind}`
    })),
    detailUrl: `${safeOrigin}/events/${event.id}`,
    registerUrl: event.registrationOpen ? `${safeOrigin}/register?eventId=${event.id}` : '',
    printUrl: `${safeOrigin}/events/${event.id}/print`
  };
}

function toIsoString(value) {
  if (!value) {
    return '';
  }

  if (typeof value.toDate === 'function') {
    return value.toDate().toISOString();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
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

  const registeredCount = Number(registrationCounts.registered || 0)
    + Number(registrationCounts.pendingPayment || 0)
    + Number(registrationCounts.held || 0);

  if (registeredCount >= capacity) {
    const pendingPaymentCount = Number(registrationCounts.pendingPayment || 0);

    return {
      isFull: true,
      label: registrationCounts.held
        ? 'Seat on hold - waitlist available'
        : pendingPaymentCount
          ? 'Seat pending payment - waitlist available'
          : 'Full - waitlist available'
    };
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
