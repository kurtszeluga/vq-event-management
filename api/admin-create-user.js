import { randomInt } from 'node:crypto';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

function initializeAdminApp() {
  if (getApps().length) {
    return;
  }

  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJson) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not configured.');
  }

  initializeApp({
    credential: cert(JSON.parse(serviceAccountJson))
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

    const auth = getAuth();
    const db = getFirestore();
    const decodedToken = await auth.verifyIdToken(idToken);
    const actorSnap = await db.collection('users').doc(decodedToken.uid).get();
    const actorProfile = actorSnap.exists ? actorSnap.data() : {};

    if (!canAddUsers(actorProfile)) {
      response.status(403).json({ error: 'This account cannot add users.' });
      return;
    }

    const payload = sanitizePayload(request.body || {}, actorProfile);

    if (!payload.name || !payload.email) {
      response.status(400).json({ error: 'Name and email are required.' });
      return;
    }

    await assertActorCanCreateOrUpdateProfile(auth, db, actorProfile, payload.email);

    const temporaryPassword = payload.temporaryPassword || createTemporaryPassword();
    const userRecord = await createOrUpdateAuthUser(auth, payload, temporaryPassword);
    const userRef = db.collection('users').doc(userRecord.uid);
    const existingProfile = await userRef.get();
    const before = existingProfile.exists ? existingProfile.data() : {};
    const now = FieldValue.serverTimestamp();
    const profile = {
      billingAddress: payload.billingAddress,
      createdDate: existingProfile.exists ? before.createdDate : now,
      email: payload.email,
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
      actorUserId: actorProfile.userId || decodedToken.uid,
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

async function createOrUpdateAuthUser(auth, payload, temporaryPassword) {
  try {
    const existingUser = await auth.getUserByEmail(payload.email);
    return auth.updateUser(existingUser.uid, {
      disabled: payload.status !== 'Active',
      displayName: payload.name,
      password: temporaryPassword
    });
  } catch (error) {
    if (error.code !== 'auth/user-not-found') {
      throw error;
    }

    return auth.createUser({
      disabled: payload.status !== 'Active',
      displayName: payload.name,
      email: payload.email,
      emailVerified: false,
      password: temporaryPassword
    });
  }
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
    name: cleanText(payload.name),
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
    viewRegistrations: Boolean(permissions.viewRegistrations)
  };

  return role === 'Admin' ? normalized : {
    manageEvents: false,
    managePayments: false,
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

async function assertActorCanCreateOrUpdateProfile(auth, db, actorProfile, email) {
  if (actorProfile.role === 'Super User') {
    return;
  }

  try {
    const existingUser = await auth.getUserByEmail(email);
    const existingProfile = await db.collection('users').doc(existingUser.uid).get();

    if (existingProfile.exists && existingProfile.data().role !== 'General User') {
      const permissionError = new Error('Admins can only add or update General User profiles.');
      permissionError.statusCode = 403;
      throw permissionError;
    }
  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      return;
    }

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
