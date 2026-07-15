import { getFirestore } from 'firebase-admin/firestore';
import { initializeAdminApp } from './_lib/public-event-feed.js';

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    initializeAdminApp();

    const email = normalizeEmail(request.body?.email);
    const eventId = String(request.body?.eventId || '').trim();

    if (!email) {
      response.status(400).json({ error: 'Email is required.' });
      return;
    }

    const db = getFirestore();
    const event = eventId ? await findEventById(db, eventId) : null;
    const allowNonMemberRegistration = Boolean(event?.allowNonMemberRegistration);
    const profile = await findUserProfileByEmail(db, email);
    const hasExistingRegistration = eventId
      ? await findActiveRegistration(db, eventId, email, profile?.userId || profile?.id || '')
      : false;
    const membershipStatus = getMembershipStatus(profile);
    const profileStatus = getProfileStatus(profile);

    response.status(200).json({
      hasExistingRegistration,
      membership: profile ? serializeMembership(profile) : null,
      membershipStatus,
      allowNonMemberRegistration,
      profile: profile ? serializeProfile(profile, profileStatus, membershipStatus) : null,
      status: getLookupStatus({
        allowNonMemberRegistration,
        hasExistingRegistration,
        membershipStatus,
        profile,
        profileStatus
      })
    });
  } catch (error) {
    response.status(500).json({ error: error.message || 'Lookup failed.' });
  }
}

async function findEventById(db, eventId) {
  const eventSnap = await db.collection('events').doc(eventId).get();
  return eventSnap.exists ? { id: eventSnap.id, ...eventSnap.data() } : null;
}

async function findUserProfileByEmail(db, email) {
  const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();

  if (snapshot.empty) {
    return null;
  }

  const docSnapshot = snapshot.docs[0];
  return { id: docSnapshot.id, ...docSnapshot.data() };
}

async function findActiveRegistration(db, eventId, email, userId) {
  const snapshot = await db
    .collection('registrations')
    .where('eventId', '==', eventId)
    .get();

  return snapshot.docs.some((docSnapshot) => {
    const registration = docSnapshot.data();

    if (!['Registered', 'Waitlisted'].includes(registration.status)) {
      return false;
    }

    return normalizeEmail(registration.email) === email || (userId && registration.userId === userId);
  });
}

function getLookupStatus({
  allowNonMemberRegistration,
  hasExistingRegistration,
  membershipStatus,
  profile,
  profileStatus
}) {
  if (hasExistingRegistration) {
    return 'already-registered';
  }

  if (profile && profileStatus === 'Active' && membershipStatus === 'Active') {
    return 'profile-active';
  }

  if (profile && profileStatus !== 'Active' && membershipStatus === 'Active') {
    return 'profile-reactivation-available';
  }

  if (profile && membershipStatus !== 'Active' && !allowNonMemberRegistration) {
    return 'profile-membership-blocked';
  }

  if (profile && membershipStatus !== 'Active' && allowNonMemberRegistration) {
    return profileStatus === 'Active' ? 'profile-active' : 'profile-reactivation-available';
  }

  if (!profile && allowNonMemberRegistration) {
    return 'non-member-registration-allowed';
  }

  if (!profile) {
    return 'membership-not-found';
  }

  return 'new-registrant';
}

function getMembershipStatus(profile) {
  return profile?.membershipStatus || 'Unknown';
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

function serializeProfile(profile, profileStatus, membershipStatus) {
  return {
    billingAddress: {
      city: profile.billingAddress?.city || '',
      country: profile.billingAddress?.country || 'United States',
      postalCode: profile.billingAddress?.postalCode || '',
      state: profile.billingAddress?.state || '',
      street: profile.billingAddress?.street || ''
    },
    email: profile.email || '',
    membershipStatus,
    name: profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' '),
    phone: profile.phone || '',
    status: profileStatus,
    userId: profile.userId || profile.id
  };
}

function serializeMembership(profile) {
  return {
    matchedBy: profile.membershipMatchedBy || 'profile',
    memberId: profile.membershipMemberId || profile.userId || profile.id || '',
    name: profile.name || [profile.firstName, profile.lastName].filter(Boolean).join(' '),
    status: profile.membershipStatus || 'Unknown'
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
