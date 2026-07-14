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

    if (!email) {
      response.status(400).json({ error: 'Email is required.' });
      return;
    }

    const db = getFirestore();
    const profile = await findUserProfileByEmail(db, email);
    const member = await findMemberByEmail(db, email);
    const membershipStatus = getMembershipStatus(profile, member);
    const profileStatus = getProfileStatus(profile);

    response.status(200).json({
      membership: member ? serializeMember(member) : null,
      membershipStatus,
      profile: profile ? serializeProfile(profile, profileStatus, membershipStatus) : null,
      status: getLookupStatus({ member, membershipStatus, profile, profileStatus })
    });
  } catch (error) {
    response.status(500).json({ error: error.message || 'Lookup failed.' });
  }
}

async function findUserProfileByEmail(db, email) {
  const snapshot = await db.collection('users').where('email', '==', email).limit(1).get();

  if (snapshot.empty) {
    return null;
  }

  const docSnapshot = snapshot.docs[0];
  return { id: docSnapshot.id, ...docSnapshot.data() };
}

async function findMemberByEmail(db, email) {
  const normalizedSnapshot = await db
    .collection('members')
    .where('normalizedEmail', '==', email)
    .limit(1)
    .get();

  if (!normalizedSnapshot.empty) {
    const docSnapshot = normalizedSnapshot.docs[0];
    return { id: docSnapshot.id, ...docSnapshot.data() };
  }

  const emailSnapshot = await db.collection('members').where('email', '==', email).limit(1).get();

  if (emailSnapshot.empty) {
    return null;
  }

  const docSnapshot = emailSnapshot.docs[0];
  return { id: docSnapshot.id, ...docSnapshot.data() };
}

function getLookupStatus({ member, membershipStatus, profile, profileStatus }) {
  if (profile && profileStatus === 'Active' && membershipStatus === 'Active') {
    return 'profile-active';
  }

  if (profile && profileStatus !== 'Active' && membershipStatus === 'Active') {
    return 'profile-reactivation-available';
  }

  if (profile && membershipStatus !== 'Active') {
    return 'profile-membership-blocked';
  }

  if (!profile && member && membershipStatus !== 'Active') {
    return 'membership-blocked';
  }

  return 'new-registrant';
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

function serializeMember(member) {
  return {
    matchedBy: 'email',
    memberId: member.memberId || member.id || '',
    name: member.name || [member.firstName, member.lastName].filter(Boolean).join(' '),
    status: member.status || 'Unknown'
  };
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
