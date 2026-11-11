import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';
import { enforceRateLimit } from './_lib/rate-limit.js';
import { getArchiveBlockError, getEventCapacityError, getEventImagesError } from './_lib/registration-capacity.js';
import { syncEventRegistrationSheet } from './_lib/event-registration-sheet.js';

let firebaseProjectId = '';

function initializeAdminApp() {
  const existingApp = getApps()[0];

  if (existingApp) {
    firebaseProjectId = existingApp.options.projectId || firebaseProjectId;
    return existingApp;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  const serviceAccount = parseServiceAccountJson(serviceAccountJson);
  firebaseProjectId = serviceAccount.project_id;

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: firebaseProjectId
  });
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    initializeAdminApp();

    const authHeader = request.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length)
      : '';

    if (!idToken) {
      response.status(401).json({ error: 'Missing authorization token.' });
      return;
    }

    const db = getFirestore();
    const decodedToken = await verifyFirebaseIdToken(idToken, firebaseProjectId);
    const actorUid = decodedToken.user_id || decodedToken.sub || decodedToken.uid;

    if (!actorUid) {
      response.status(401).json({ error: 'Invalid authorization token.' });
      return;
    }

    const actorSnap = await db.collection('users').doc(actorUid).get();
    const actorProfile = actorSnap.exists ? actorSnap.data() : {};

    await enforceRateLimit(db, {
      keyParts: [actorUid, request.body?.action || 'update'],
      limit: 60,
      message: 'Too many event management requests.',
      request,
      scope: 'admin-manage-event',
      windowMs: 10 * 60 * 1000
    });

    const requestedAction = cleanText(request.body?.action) || 'update';

    // Ahead of the manage-events gate, on a looser permission. Resyncing a
    // sheet rewrites it from the registrations and changes nothing else, so a
    // coordinator who can see an event's registrations can ask for it - they
    // are the ones looking at a stale sheet, and they often cannot edit events.
    if (requestedAction === 'syncRegistrationSheet') {
      if (!canViewRegistrations(actorProfile)) {
        response.status(403).json({ error: 'This account cannot view registrations.' });
        return;
      }

      const eventId = cleanText(request.body?.eventId);

      if (!eventId) {
        response.status(400).json({ error: 'Event ID is required.' });
        return;
      }

      // Never throws, so its own result is what tells the admin whether the
      // sheet was written and why not if it was not.
      response.status(200).json(await syncEventRegistrationSheet(db, eventId));
      return;
    }

    if (!canManageEvents(actorProfile)) {
      response.status(403).json({ error: 'This account cannot manage events.' });
      return;
    }

    const action = requestedAction;
    const eventId = cleanText(request.body?.eventId);
    const eventData = request.body?.eventData && typeof request.body.eventData === 'object'
      ? request.body.eventData
      : {};

    if (action === 'create' || action === 'update') {
      const capacityError = getEventCapacityError(eventData);

      if (capacityError) {
        response.status(400).json({ error: capacityError });
        return;
      }

      const imagesError = getEventImagesError(eventData);

      if (imagesError) {
        response.status(400).json({ error: imagesError });
        return;
      }
    }

    if (action === 'create') {
      const eventRef = db.collection('events').doc();
      const payload = sanitizeEventPayload(eventData, eventRef.id);
      const batch = db.batch();

      batch.set(eventRef, {
        ...payload,
        createdDate: FieldValue.serverTimestamp(),
        updatedDate: FieldValue.serverTimestamp()
      });
      batch.set(db.collection('auditLogs').doc(), buildAuditLog({
        action: 'Create',
        actorProfile,
        actorUid,
        after: payload,
        before: {},
        entityId: eventRef.id,
        summary: `Created event "${getEventAuditTitle(payload)}"`
      }));
      await batch.commit();

      // This is what makes "set up an event with registration enabled" and
      // "the event has a sheet" the same act. After the commit, since the sync
      // reads the event it is about to mirror. Never throws and skips itself
      // when the event takes no registrations, so no branch is needed here.
      await syncEventRegistrationSheet(db, eventRef.id);

      response.status(200).json({ eventId: eventRef.id, ok: true });
      return;
    }

    if (!eventId) {
      response.status(400).json({ error: 'Event ID is required.' });
      return;
    }

    const eventRef = db.collection('events').doc(eventId);
    const eventSnap = await eventRef.get();

    if (!eventSnap.exists) {
      response.status(404).json({ error: 'Event was not found.' });
      return;
    }

    const before = eventSnap.data();
    const batch = db.batch();

    if (action === 'delete') {
      batch.delete(eventRef);
      batch.set(db.collection('auditLogs').doc(), buildAuditLog({
        action: 'Delete',
        actorProfile,
        actorUid,
        after: {},
        before,
        entityId: eventId,
        summary: `Deleted event "${before.title || eventId}"`
      }));
      await batch.commit();
      response.status(200).json({ ok: true });
      return;
    }

    if (action === 'archive') {
      const registrationsSnapshot = await db.collection('registrations')
        .where('eventId', '==', eventId)
        .get();
      const archiveBlockError = getArchiveBlockError(
        registrationsSnapshot.docs.map((registrationDoc) => registrationDoc.data())
      );

      if (archiveBlockError) {
        response.status(409).json({ error: archiveBlockError });
        return;
      }

      batch.update(eventRef, {
        status: 'Archived',
        updatedDate: FieldValue.serverTimestamp()
      });
      batch.set(db.collection('auditLogs').doc(), buildAuditLog({
        action: 'Archive',
        actorProfile,
        actorUid,
        after: { status: 'Archived' },
        before,
        entityId: eventId,
        summary: `Archived event "${before.title || eventId}"`
      }));
      await batch.commit();
      response.status(200).json({ ok: true });
      return;
    }

    if (action === 'reactivate') {
      batch.update(eventRef, {
        status: 'Published',
        updatedDate: FieldValue.serverTimestamp()
      });
      batch.set(db.collection('auditLogs').doc(), buildAuditLog({
        action: 'Reactivate',
        actorProfile,
        actorUid,
        after: { status: 'Published' },
        before,
        entityId: eventId,
        summary: `Reactivated event "${before.title || eventId}"`
      }));
      await batch.commit();
      response.status(200).json({ ok: true });
      return;
    }

    const payload = sanitizeEventPayload(eventData, eventId);
    batch.set(eventRef, {
      ...payload,
      createdDate: before.createdDate || FieldValue.serverTimestamp(),
      updatedDate: FieldValue.serverTimestamp()
    }, { merge: false });
    batch.set(db.collection('auditLogs').doc(), buildAuditLog({
      action: 'Update',
      actorProfile,
      actorUid,
      after: payload,
      before,
      entityId: eventId,
      summary: `Updated event "${getEventAuditTitle(payload)}"`
    }));
    await batch.commit();

    // Catches the event that had registration switched on after it was first
    // created, and renames the sheet when the title or date changed.
    await syncEventRegistrationSheet(db, eventId);

    response.status(200).json({ eventId, ok: true });
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: error.message });
  }
}

function canManageEvents(actorProfile) {
  if (actorProfile.status !== 'Active') {
    return false;
  }

  return actorProfile.role === 'Super User'
    || actorProfile.role === 'Admin' && actorProfile.permissions?.manageEvents === true;
}

// Matches canUpdateRegistrationPayments in admin-update-registration-payment.js
// and the viewRegistrations checks in firestore.rules - the people who can see
// an event's registration list.
function canViewRegistrations(actorProfile) {
  if (actorProfile.status !== 'Active') {
    return false;
  }

  if (actorProfile.role === 'Super User') {
    return true;
  }

  return actorProfile.role === 'Admin'
    && (
      actorProfile.permissions?.viewRegistrations === true
      || actorProfile.permissions?.manageEvents === true
    );
}

function sanitizeEventPayload(eventData, eventId) {
  const payload = {
    ...eventData,
    eventId
  };

  delete payload.createdDate;
  delete payload.updatedDate;
  delete payload.id;

  // Defense in depth: the admin UI never lets a Cash/Check Only event carry a
  // service fee (there is no card transaction for it to cover), but a
  // tampered or stale request must not be able to sneak one in either.
  if (payload.cashCheckOnly) {
    payload.serviceFee = 0;
  }

  return removeUndefinedFields(payload);
}

function buildAuditLog({ action, actorProfile, actorUid, after, before, entityId, summary }) {
  return {
    action,
    actorEmail: actorProfile.email || '',
    actorName: actorProfile.name || actorProfile.email || 'Unknown Admin',
    actorRole: actorProfile.role || '',
    actorUserId: actorProfile.userId || actorUid,
    after,
    before,
    createdDate: FieldValue.serverTimestamp(),
    entityId,
    entityType: 'Event',
    summary
  };
}

function getEventAuditTitle(eventData) {
  return eventData.title || eventData.eventType || 'Untitled Draft';
}

function cleanText(value) {
  return String(value || '').trim();
}

function removeUndefinedFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

function parseServiceAccountJson(serviceAccountJson) {
  const trimmed = String(serviceAccountJson || '').trim();

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    try {
      return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
    } catch {
      throw new Error(`Unable to parse FIREBASE_SERVICE_ACCOUNT_JSON: ${error.message}`);
    }
  }
}
