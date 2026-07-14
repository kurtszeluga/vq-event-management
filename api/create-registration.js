import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { initializeAdminApp } from './_lib/public-event-feed.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    initializeAdminApp();

    const payload = sanitizeRegistrationPayload(request.body || {});

    if (!payload.eventId) {
      response.status(400).json({ error: 'Select an event before registering.' });
      return;
    }

    if (!payload.name || !payload.email || !payload.phone) {
      response.status(400).json({ error: 'Name, email, and phone are required.' });
      return;
    }

    const db = getFirestore();
    const result = await createRegistration(db, payload);

    response.status(200).json(result);
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Registration could not be completed.'
    });
  }
}

async function createRegistration(db, payload) {
  const eventRef = db.collection('events').doc(payload.eventId);
  const registrationRef = db.collection('registrations').doc();
  const auditRef = db.collection('auditLogs').doc();

  return db.runTransaction(async (transaction) => {
    const eventSnap = await transaction.get(eventRef);

    if (!eventSnap.exists) {
      throw httpError(404, 'This event is no longer available.');
    }

    const event = { id: eventSnap.id, ...eventSnap.data() };
    const profile = payload.profileUserId
      ? await getProfileById(transaction, db, payload.profileUserId, payload.email)
      : await findUserProfileByEmail(db, payload.email);
    const member = await findBestMemberMatch(db, payload.email, payload.phone);
    const membershipStatus = getMembershipStatus(profile, member);
    const profileStatus = getProfileStatus(profile);

    validateRegistrationEligibility(event, {
      membershipStatus,
      profile,
      profileStatus,
      reactivateProfile: payload.reactivateProfile
    });

    const existingSnapshot = await transaction.get(
      db.collection('registrations').where('eventId', '==', payload.eventId)
    );
    const existingRegistrations = existingSnapshot.docs.map((docSnapshot) => ({
      id: docSnapshot.id,
      ...docSnapshot.data()
    }));
    const alreadyRegistered = existingRegistrations.some((registration) =>
      ['Registered', 'Waitlisted'].includes(registration.status)
        && (
          normalizeEmail(registration.email) === payload.email
          || (profile?.id && registration.userId === (profile.userId || profile.id))
        )
    );

    if (alreadyRegistered) {
      throw httpError(409, 'An active registration already exists for this email and event.');
    }

    const registeredCount = existingRegistrations.filter(
      (registration) => registration.status === 'Registered'
    ).length;
    const hasCapacity = Boolean(event.capacityUnlimited) || registeredCount < Number(event.capacity || 0);
    const status = hasCapacity ? 'Registered' : 'Waitlisted';
    const isPaidEvent = Boolean(event.isPaid) && Number(event.cost || 0) > 0;
    const userId = profile?.userId || profile?.id || '';
    const registration = {
      email: payload.email,
      eventId: payload.eventId,
      name: payload.name,
      paymentStatus: isPaidEvent ? 'Pending' : 'Paid',
      phone: payload.phone,
      registrationDate: FieldValue.serverTimestamp(),
      registrationId: registrationRef.id,
      status,
      userId
    };

    if (profile && payload.reactivateProfile && profileStatus !== 'Active') {
      transaction.update(db.collection('users').doc(profile.id), {
        archivedBy: FieldValue.delete(),
        archivedDate: FieldValue.delete(),
        status: 'Active',
        updatedDate: FieldValue.serverTimestamp()
      });
    }

    transaction.set(registrationRef, registration);
    transaction.set(auditRef, {
      action: 'Register',
      actorEmail: payload.email,
      actorName: payload.name,
      actorRole: profile?.role || 'Guest',
      actorUserId: userId,
      after: {
        ...registration,
        registrationDate: null
      },
      before: {},
      createdDate: FieldValue.serverTimestamp(),
      entityId: registrationRef.id,
      entityType: 'Registration',
      summary: `${payload.name} registered for "${event.title || event.eventType || payload.eventId}"`
    });

    return {
      eventTitle: event.title || '',
      membershipStatus,
      paymentRequired: isPaidEvent,
      paymentStatus: registration.paymentStatus,
      profileReactivated: Boolean(profile && payload.reactivateProfile && profileStatus !== 'Active'),
      registrationId: registrationRef.id,
      registeredCount: registeredCount + (status === 'Registered' ? 1 : 0),
      status
    };
  });
}

async function getProfileById(transaction, db, profileUserId, email) {
  const profileRef = db.collection('users').doc(profileUserId);
  const profileSnap = await transaction.get(profileRef);

  if (!profileSnap.exists) {
    throw httpError(404, 'The matched profile could not be found.');
  }

  const profile = { id: profileSnap.id, ...profileSnap.data() };

  if (normalizeEmail(profile.email) !== email) {
    throw httpError(400, 'The matched profile does not match this email.');
  }

  return profile;
}

async function findUserProfileByEmail(db, email) {
  const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();

  if (snapshot.empty) {
    return null;
  }

  const docSnapshot = snapshot.docs[0];
  return { id: docSnapshot.id, ...docSnapshot.data() };
}

async function findBestMemberMatch(db, email, phone) {
  const byEmail = await findMemberByField(db, 'normalizedEmail', email)
    || await findMemberByField(db, 'email', email);

  if (byEmail) {
    return { ...byEmail, matchedBy: 'email' };
  }

  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    return null;
  }

  const byPhone = await findMemberByField(db, 'normalizedPhone', normalizedPhone);
  return byPhone ? { ...byPhone, matchedBy: 'phone' } : null;
}

async function findMemberByField(db, field, value) {
  if (!value) {
    return null;
  }

  const snapshot = await db.collection('members').where(field, '==', value).limit(1).get();

  if (snapshot.empty) {
    return null;
  }

  const docSnapshot = snapshot.docs[0];
  return { id: docSnapshot.id, ...docSnapshot.data() };
}

function validateRegistrationEligibility(event, { membershipStatus, profile, profileStatus, reactivateProfile }) {
  if (!isEventVisible(event)) {
    throw httpError(404, 'This event is not currently available.');
  }

  if (!event.registrationOpen) {
    throw httpError(400, 'Registration is not currently open for this event.');
  }

  if (['Business Listing', 'For Sale'].includes(event.eventType)) {
    throw httpError(400, 'This listing does not accept registrations.');
  }

  if (profile && profileStatus !== 'Active' && !reactivateProfile) {
    throw httpError(400, 'Please confirm whether you want to reactivate the matched profile.');
  }

  if (membershipStatus !== 'Active') {
    throw httpError(403, 'Your membership status is not currently active. Please contact an administrator before registering.');
  }
}

function getMembershipStatus(profile, member) {
  if (member?.status === 'Active') {
    return 'Active';
  }

  if (profile?.membershipStatus) {
    return profile.membershipStatus;
  }

  if (member?.status) {
    return member.status;
  }

  return 'Unknown';
}

function getProfileStatus(profile) {
  if (!profile) {
    return '';
  }

  if (profile.archivedBy || profile.archivedDate || profile.status === 'Archived') {
    return 'Archived';
  }

  return profile.status || 'Unknown';
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

function sanitizeRegistrationPayload(payload) {
  return {
    email: normalizeEmail(payload.email),
    eventId: String(payload.eventId || '').trim(),
    name: normalizeName(payload.name || ''),
    phone: String(payload.phone || '').trim(),
    profileUserId: String(payload.profileUserId || '').trim(),
    reactivateProfile: Boolean(payload.reactivateProfile)
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '').slice(-10);
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
