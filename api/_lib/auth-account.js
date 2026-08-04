import { getGoogleAccessToken } from './google-access-token.js';

// Signing in with a verification code mints a custom token for the profile's
// document id and lets Firebase create the Auth user on first use. Firebase
// creates that record with the uid and NOTHING ELSE - no email address.
//
// An Auth record with no email cannot be found by signInWithEmailAndPassword,
// which resolves accounts by email, so the member is permanently unable to use
// a password no matter what one is set for them. The admin "Change Password"
// panel appears to work and writes a credential that can never be matched.
//
// That matters at scale here: every CSV-imported member is a Firestore profile
// with a slug id (makeProfileDocumentId) and no Auth record, so each one is a
// candidate the first time they use a code. Creating the record properly
// up-front, with its email, is what keeps them able to set a password later.
export async function ensureAuthUserForProfile(db, projectId, profileUserId) {
  const profileSnap = await db.collection('users').doc(profileUserId).get();
  const email = String(profileSnap.exists ? profileSnap.data().email || '' : '').trim().toLowerCase();

  if (!email) {
    return { changed: false, reason: 'no-profile-email' };
  }

  const existing = await lookupAuthUser(projectId, profileUserId);

  if (!existing) {
    // localId is honoured on the admin endpoint, which is what keeps the Auth
    // uid equal to the profile document id the custom token is minted for.
    await identityPlatformRequest(projectId, 'accounts', {
      email,
      emailVerified: true,
      localId: profileUserId
    });

    return { changed: true, reason: 'created' };
  }

  if (!existing.email) {
    await identityPlatformRequest(projectId, 'accounts:update', {
      email,
      emailVerified: true,
      localId: profileUserId
    });

    return { changed: true, reason: 'email-backfilled' };
  }

  return { changed: false, reason: 'already-complete' };
}

async function lookupAuthUser(projectId, localId) {
  const data = await identityPlatformRequest(projectId, 'accounts:lookup', {
    localId: [localId]
  });

  return data.users?.[0] || null;
}

async function identityPlatformRequest(projectId, methodPath, body) {
  const accessToken = await getGoogleAccessToken(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${projectId}/${methodPath}`,
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
