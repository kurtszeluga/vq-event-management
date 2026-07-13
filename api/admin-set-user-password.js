import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';

let firebaseProjectId = '';
let firebaseApiKey = '';

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

    const db = getFirestore();
    firebaseApiKey = getFirebaseApiKey();
    const decodedToken = await verifyFirebaseIdToken(idToken, firebaseProjectId);
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
    await updateAuthUser(userProfile.userId || userId, { password });

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

function getFirebaseApiKey() {
  return process.env.VITE_FIREBASE_API_KEY
    || process.env.FIREBASE_API_KEY
    || '';
}

async function updateAuthUser(localId, { password }) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${firebaseApiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        localId,
        password,
        returnSecureToken: false
      })
    }
  );

  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    const message = data.error?.message || data.error || 'Firebase Auth request failed.';
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
