import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getGoogleAccessToken } from './_lib/google-access-token.js';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';

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

    if (!canUpdateUsers(actorProfile)) {
      response.status(403).json({ error: 'This account cannot update user profiles.' });
      return;
    }

    const targetProfileId = cleanText(request.body?.profileId || request.body?.userId);

    if (!targetProfileId) {
      response.status(400).json({ error: 'User profile ID is required.' });
      return;
    }

    const userRef = db.collection('users').doc(targetProfileId);
    const targetSnap = await userRef.get();

    if (!targetSnap.exists) {
      response.status(404).json({ error: 'User profile was not found.' });
      return;
    }

    const before = targetSnap.data();

    if (!canUpdateTarget(actorProfile, before)) {
      response.status(403).json({ error: 'Admins can only update General User profiles.' });
      return;
    }

    const payload = sanitizePayload(request.body || {}, actorProfile, before, targetProfileId);

    if (!payload.firstName || !payload.lastName || !payload.email) {
      response.status(400).json({ error: 'First name, last name, and email are required.' });
      return;
    }

    const now = FieldValue.serverTimestamp();
    const profile = removeUndefinedFields({
      archivedBy: before.archivedBy,
      archivedDate: before.archivedDate,
      billingAddress: payload.billingAddress,
      createdDate: before.createdDate || now,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      membershipMatchedBy: before.membershipMatchedBy || '',
      membershipMemberId: before.membershipMemberId || '',
      membershipStatus: payload.membershipStatus,
      membershipUpdatedDate:
        payload.membershipStatus !== before.membershipStatus
          ? now
          : before.membershipUpdatedDate || now,
      name: payload.name,
      permissions: getPermissionsForRole(payload.role, payload.permissions),
      phone: payload.phone,
      profileTags: payload.profileTags,
      role: payload.role,
      status: payload.status,
      updatedDate: now,
      userId: before.userId || targetProfileId
    });

    try {
      await updateAuthUser(profile.userId, {
        disabled: profile.status !== 'Active',
        displayName: profile.name,
        email: profile.email
      });
    } catch (authError) {
      if (!String(authError.message || '').includes('USER_NOT_FOUND')) {
        throw authError;
      }

      console.warn('Firebase Auth user was not found for profile update', profile.userId);
    }

    const batch = db.batch();

    batch.set(userRef, profile);
    batch.set(db.collection('auditLogs').doc(), {
      action: 'Update',
      actorEmail: actorProfile.email || '',
      actorName: actorProfile.name || actorProfile.email || 'Unknown Admin',
      actorRole: actorProfile.role || '',
      actorUserId: actorProfile.userId || actorUid,
      after: {
        ...profile,
        createdDate: before.createdDate || null,
        membershipUpdatedDate: null,
        updatedDate: null
      },
      before,
      createdDate: now,
      entityId: targetProfileId,
      entityType: 'User',
      summary: `Updated user "${profile.name || profile.email || targetProfileId}"`
    });
    await batch.commit();

    response.status(200).json({
      user: {
        email: profile.email,
        name: profile.name,
        role: profile.role,
        status: profile.status,
        userId: profile.userId
      }
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: error.message });
  }
}

function sanitizePayload(payload, actorProfile, before, profileId) {
  const isSuperUser = actorProfile.role === 'Super User';
  const requestedRole = ['Super User', 'Admin', 'General User'].includes(payload.role)
    ? payload.role
    : before.role || 'General User';
  const role = isSuperUser ? requestedRole : 'General User';
  const canManageMembershipStatus =
    isSuperUser || actorProfile.permissions?.manageMembershipStatus === true;
  const requestedMembershipStatus = ['Active', 'Inactive', 'Archived', 'Unknown'].includes(
    payload.membershipStatus
  )
    ? payload.membershipStatus
    : before.membershipStatus || 'Unknown';

  return {
    billingAddress: {
      city: cleanText(payload.billingAddress?.city),
      country: cleanText(payload.billingAddress?.country) || 'United States',
      postalCode: cleanText(payload.billingAddress?.postalCode),
      state: cleanText(payload.billingAddress?.state).toUpperCase(),
      street: cleanText(payload.billingAddress?.street)
    },
    email: cleanText(payload.email).toLowerCase(),
    firstName: toTitleCase(cleanText(payload.firstName)),
    lastName: toTitleCase(cleanText(payload.lastName)),
    membershipStatus: canManageMembershipStatus
      ? requestedMembershipStatus
      : before.membershipStatus || 'Unknown',
    name: buildDisplayName(payload.firstName, payload.lastName),
    permissions: payload.permissions || {},
    phone: cleanText(payload.phone),
    profileTags: isSuperUser
      ? normalizeProfileTags(payload.profileTags)
      : normalizeProfileTags(before.profileTags),
    role,
    status: role === 'Super User'
      ? 'Active'
      : payload.status === 'Inactive'
        ? 'Inactive'
        : 'Active',
    userId: before.userId || profileId
  };
}

function getPermissionsForRole(role, permissions = {}) {
  const normalized = {
    addUsers: Boolean(permissions.addUsers),
    manageEvents: Boolean(permissions.manageEvents),
    managePayments: Boolean(permissions.managePayments),
    manageMembershipStatus: Boolean(permissions.manageMembershipStatus),
    viewRegistrations: Boolean(permissions.viewRegistrations)
  };

  return role === 'Admin' ? normalized : {
    addUsers: false,
    manageEvents: false,
    managePayments: false,
    manageMembershipStatus: false,
    viewRegistrations: false
  };
}

function canUpdateUsers(actorProfile) {
  if (actorProfile.status !== 'Active') {
    return false;
  }

  return actorProfile.role === 'Super User'
    || actorProfile.role === 'Admin' && actorProfile.permissions?.addUsers === true;
}

function canUpdateTarget(actorProfile, targetProfile) {
  return actorProfile.role === 'Super User' || targetProfile.role === 'General User';
}

function normalizeProfileTags(profileTags = []) {
  const allowedTags = ['vqBooking', 'vqHosting'];

  return Array.isArray(profileTags)
    ? profileTags.filter((tag) => allowedTags.includes(tag))
    : [];
}

async function updateAuthUser(localId, { disabled, displayName, email }) {
  return identityPlatformRequest('accounts:update', {
    disableUser: Boolean(disabled),
    displayName,
    email,
    localId,
    returnSecureToken: false
  });
}

async function identityPlatformRequest(methodPath, body) {
  const accessToken = await getGoogleAccessToken(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${firebaseProjectId}/${methodPath}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    }
  );

  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const message = data.error?.message || data.error || 'Identity Platform request failed.';
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  return data;
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function buildDisplayName(firstName, lastName) {
  return [toTitleCase(cleanText(firstName)), toTitleCase(cleanText(lastName))]
    .filter(Boolean)
    .join(' ');
}

function toTitleCase(value) {
  return value
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function removeUndefinedFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
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
