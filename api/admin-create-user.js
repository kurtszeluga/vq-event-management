import { randomInt } from 'node:crypto';
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

  initializeApp({
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

    if (!canAddUsers(actorProfile)) {
      response.status(403).json({ error: 'This account cannot add users.' });
      return;
    }

    const payload = sanitizePayload(request.body || {}, actorProfile);

    if (!payload.firstName || !payload.lastName || !payload.email) {
      response.status(400).json({ error: 'First name, last name, and email are required.' });
      return;
    }

    await assertActorCanCreateOrUpdateProfile(db, actorProfile, payload.email);

    const temporaryPassword = payload.temporaryPassword || createTemporaryPassword();
    const userRecord = await createOrUpdateAuthUser(payload, temporaryPassword);
    const userRef = db.collection('users').doc(userRecord.uid);
    const existingProfile = await userRef.get();
    const before = existingProfile.exists ? existingProfile.data() : {};
    const now = FieldValue.serverTimestamp();
    const profile = {
      billingAddress: payload.billingAddress,
      createdDate: existingProfile.exists ? before.createdDate : now,
      email: payload.email,
      firstName: payload.firstName,
      lastName: payload.lastName,
      membershipMatchedBy: existingProfile.exists ? before.membershipMatchedBy || '' : '',
      membershipMemberId: existingProfile.exists ? before.membershipMemberId || '' : '',
      membershipStatus: existingProfile.exists ? before.membershipStatus || 'Unknown' : 'Unknown',
      membershipUpdatedDate: existingProfile.exists ? before.membershipUpdatedDate || now : now,
      name: payload.name,
      permissions: getPermissionsForRole(payload.role, payload.permissions),
      phone: payload.phone,
      profileTags: payload.profileTags,
      role: payload.role,
      status: payload.status,
      updatedDate: now,
      userId: userRecord.uid
    };
    const batch = db.batch();

    batch.set(userRef, profile, { merge: true });
    batch.set(db.collection('auditLogs').doc(), {
      action: existingProfile.exists ? 'Update' : 'Create',
      actorEmail: actorProfile.email || '',
      actorName: actorProfile.name || actorProfile.email || 'Unknown Admin',
      actorRole: actorProfile.role || '',
      actorUserId: actorProfile.userId || actorUid,
      after: {
        ...profile,
        createdDate: existingProfile.exists ? before.createdDate || null : null,
        updatedDate: null
      },
      before,
      createdDate: now,
      entityId: userRecord.uid,
      entityType: 'User',
      summary: `${existingProfile.exists ? 'Updated' : 'Created'} user "${payload.name}"`
    });
    await batch.commit();

    response.status(200).json({
      temporaryPassword,
      user: {
        email: payload.email,
        name: payload.name,
        role: payload.role,
        status: payload.status,
        userId: userRecord.uid
      }
    });
  } catch (error) {
    response.status(error.statusCode || 500).json({ error: error.message });
  }
}

async function createOrUpdateAuthUser(payload, temporaryPassword) {
  const existingUser = await lookupAuthUserByEmail(payload.email);

  if (existingUser) {
    await updateAuthUser(existingUser.localId, {
      disabled: payload.status !== 'Active',
      displayName: payload.name,
      password: temporaryPassword
    });

    return {
      uid: existingUser.localId
    };
  }

  const createdUser = await createAuthUser({
    disabled: payload.status !== 'Active',
    displayName: payload.name,
    email: payload.email,
    password: temporaryPassword
  });

  return {
    uid: createdUser.localId
  };
}

function sanitizePayload(payload, actorProfile) {
  const isSuperUser = actorProfile.role === 'Super User';
  const requestedRole = ['Super User', 'Admin', 'General User'].includes(payload.role)
    ? payload.role
    : 'General User';

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
    name: buildDisplayName(payload.firstName, payload.lastName),
    permissions: payload.permissions || {},
    phone: cleanText(payload.phone),
    profileTags: normalizeProfileTags(payload.profileTags),
    role: isSuperUser ? requestedRole : 'General User',
    status: payload.status === 'Inactive' ? 'Inactive' : 'Active',
    temporaryPassword:
      typeof payload.temporaryPassword === 'string' && payload.temporaryPassword.length >= 8
        ? payload.temporaryPassword
        : ''
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
    manageEvents: false,
    managePayments: false,
    manageMembershipStatus: false,
    viewRegistrations: false,
    addUsers: false
  };
}

function normalizeProfileTags(profileTags = []) {
  const allowedTags = ['vqBooking', 'vqHosting', 'teacher', 'volunteer'];

  return Array.isArray(profileTags)
    ? profileTags.filter((tag) => allowedTags.includes(tag))
    : [];
}

async function assertActorCanCreateOrUpdateProfile(db, actorProfile, email) {
  if (actorProfile.role === 'Super User') {
    return;
  }

  try {
    const existingUser = await lookupAuthUserByEmail(email);

    if (!existingUser) {
      return;
    }

    const existingProfile = await db.collection('users').doc(existingUser.localId).get();

    if (existingProfile.exists && existingProfile.data().role !== 'General User') {
      const permissionError = new Error('Admins can only add or update General User profiles.');
      permissionError.statusCode = 403;
      throw permissionError;
    }
  } catch (error) {
    throw error;
  }
}

function canAddUsers(actorProfile) {
  if (actorProfile.status !== 'Active') {
    return false;
  }

  return actorProfile.role === 'Super User'
    || actorProfile.role === 'Admin' && actorProfile.permissions?.addUsers === true;
}

function createTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!%#';
  let password = '';

  for (let index = 0; index < 14; index += 1) {
    password += alphabet[randomInt(alphabet.length)];
  }

  return password;
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

async function lookupAuthUserByEmail(email) {
  const result = await identityPlatformRequest('accounts:lookup', {
    email: [email]
  });

  return result.users?.[0] || null;
}

async function createAuthUser({ disabled, displayName, email, password }) {
  const apiKey = process.env.VITE_FIREBASE_API_KEY || process.env.FIREBASE_API_KEY || '';

  if (!apiKey) {
    throw new Error('Firebase API key is not configured.');
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        displayName,
        email,
        password,
        returnSecureToken: false
      })
    }
  );

  const text = await response.text();
  const result = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const message = result.error?.message || result.error || 'Firebase Auth request failed.';
    const error = new Error(message);
    error.statusCode = response.status;
    throw error;
  }

  if (disabled) {
    await updateAuthUser(result.localId, {
      disabled,
      displayName,
      password
    });
  }

  return result;
}

async function updateAuthUser(localId, { disabled, displayName, password }) {
  return identityPlatformRequest('accounts:update', {
    disableUser: Boolean(disabled),
    displayName,
    localId,
    password,
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
