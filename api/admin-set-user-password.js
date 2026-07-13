import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

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

    const { password, userId } = request.body || {};

    if (!userId || typeof userId !== 'string') {
      response.status(400).json({ error: 'User ID is required.' });
      return;
    }

    if (!password || typeof password !== 'string' || password.length < 8) {
      response.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }

    const auth = getAuth();
    const db = getFirestore();
    const decodedToken = await verifyFirebaseIdToken(idToken);
    const actorUid = decodedToken.user_id || decodedToken.sub || decodedToken.uid;

    if (!actorUid) {
      response.status(401).json({ error: 'Invalid authorization token.' });
      return;
    }

    const actorSnap = await db.collection('users').doc(actorUid).get();
    const actorProfile = actorSnap.exists ? actorSnap.data() : {};

    if (actorProfile.role !== 'Super User' || actorProfile.status !== 'Active') {
      response.status(403).json({ error: 'Only active Super Users can change user passwords.' });
      return;
    }

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      response.status(404).json({ error: 'User profile was not found.' });
      return;
    }

    const userProfile = userSnap.data();
    await auth.updateUser(userProfile.userId || userId, { password });

    await db.collection('auditLogs').doc().set({
      action: 'Update',
      actorEmail: actorProfile.email || '',
      actorName: actorProfile.name || actorProfile.email || 'Unknown Admin',
      actorRole: actorProfile.role || '',
      actorUserId: actorProfile.userId || actorUid,
      after: {
        passwordChanged: true,
        userEmail: userProfile.email || '',
        userName: userProfile.name || ''
      },
      before: {},
      createdDate: FieldValue.serverTimestamp(),
      entityId: userId,
      entityType: 'User',
      summary: `Changed password for user "${userProfile.name || userProfile.email || userId}"`
    });

    response.status(200).json({ ok: true });
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}

async function verifyFirebaseIdToken(idToken) {
  initializeAdminApp();

  if (!firebaseProjectId) {
    throw new Error('Firebase project ID is not configured.');
  }

  const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
    audience: firebaseProjectId,
    issuer: `https://securetoken.google.com/${firebaseProjectId}`
  });

  return payload;
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
