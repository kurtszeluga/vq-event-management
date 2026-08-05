import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { lookupAuthAccounts } from './_lib/auth-account.js';
import { verifyFirebaseIdToken } from './_lib/firebase-token.js';
import { enforceRateLimit } from './_lib/rate-limit.js';

// Read-only sign-in history for the admin user list: when each member last
// signed in, and whether they have a password at all.
//
// Deliberately not mirrored onto the profile documents. Firebase Auth already
// records both, so a copy in Firestore would need a write on a client-side auth
// event plus a rules change to permit it, and would drift silently whenever
// that write failed. Reading the source cannot drift.
//
// Its own endpoint rather than an action on admin-update-user-profile: nothing
// here writes, and the capability it needs is "may see the user list", not "may
// change a profile".

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

  const serviceAccount = JSON.parse(serviceAccountJson);
  firebaseProjectId = serviceAccount.project_id;

  return initializeApp({
    credential: cert(serviceAccount),
    projectId: firebaseProjectId
  });
}

// Matches who can open User Controls at all: a Super User, or an Admin allowed
// to add users. Sign-in history is ordinary admin information, but it is still
// information about other members, so it does not go to a General User.
function canReadAuthStatus(actorProfile) {
  if (actorProfile.status !== 'Active') {
    return false;
  }

  return actorProfile.role === 'Super User'
    || actorProfile.role === 'Admin' && actorProfile.permissions?.addUsers === true;
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');

  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    initializeAdminApp();

    const authHeader = request.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : '';

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

    await enforceRateLimit(db, {
      keyParts: [actorUid],
      limit: 60,
      message: 'Too many sign-in history requests. Please wait and try again later.',
      request,
      scope: 'admin-user-auth-status',
      windowMs: 10 * 60 * 1000
    });

    const actorSnap = await db.collection('users').doc(actorUid).get();
    const actorProfile = actorSnap.exists ? actorSnap.data() : {};

    if (!canReadAuthStatus(actorProfile)) {
      response.status(403).json({ error: 'This account cannot read sign-in history.' });
      return;
    }

    const requested = Array.isArray(request.body?.userIds) ? request.body.userIds : [];
    // Bounded so one request cannot fan out into an unbounded number of
    // Identity Platform calls. The member list pages well inside this.
    const userIds = requested
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .slice(0, 1000);

    if (!userIds.length) {
      response.status(200).json({ accounts: {} });
      return;
    }

    const accounts = await lookupAuthAccounts(firebaseProjectId, userIds);

    response.status(200).json({ accounts });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Sign-in history could not be loaded.'
    });
  }
}
