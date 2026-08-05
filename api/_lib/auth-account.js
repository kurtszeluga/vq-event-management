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
// Also reports whether the account can actually be signed into with a
// password. A code-verified session for an account that has none is
// provisional - the member has to set one or be signed back out - so both
// callers need to tell the two apart, and the lookup below already has the
// answer without a second round trip.
export async function ensureAuthUserForProfile(db, projectId, profileUserId) {
  const profileSnap = await db.collection('users').doc(profileUserId).get();
  const email = String(profileSnap.exists ? profileSnap.data().email || '' : '').trim().toLowerCase();

  if (!email) {
    return { changed: false, hasPassword: false, reason: 'no-profile-email' };
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

    // Brand new, so no credential of any kind yet.
    return { changed: true, hasPassword: false, reason: 'created' };
  }

  if (!existing.email) {
    await identityPlatformRequest(projectId, 'accounts:update', {
      email,
      emailVerified: true,
      localId: profileUserId
    });

    return { changed: true, hasPassword: authUserHasPassword(existing), reason: 'email-backfilled' };
  }

  return { changed: false, hasPassword: authUserHasPassword(existing), reason: 'already-complete' };
}

// Identity Platform reports a password credential two ways depending on how the
// account was made, so check both rather than trusting one to be present.
function authUserHasPassword(authUser) {
  const providers = Array.isArray(authUser?.providerUserInfo) ? authUser.providerUserInfo : [];

  return Boolean(authUser?.passwordHash)
    || providers.some((provider) => provider?.providerId === 'password');
}

// Sign-in history for a list of profiles, straight from Identity Platform
// rather than mirrored into Firestore. Nothing writes a lastSignInAt on the
// profile: doing that would need a write on a client-side auth event, a rules
// change to let a member touch the field, and it would silently drift whenever
// that write failed. This cannot drift because it is the source.
//
// accounts:lookup caps the ids per request, so long lists are chunked.
const AUTH_LOOKUP_CHUNK_SIZE = 100;

export async function lookupAuthAccounts(projectId, localIds) {
  const unique = [...new Set(localIds.filter(Boolean))];
  const accounts = {};

  for (let index = 0; index < unique.length; index += AUTH_LOOKUP_CHUNK_SIZE) {
    const chunk = unique.slice(index, index + AUTH_LOOKUP_CHUNK_SIZE);
    const data = await identityPlatformRequest(projectId, 'accounts:lookup', { localId: chunk });

    (data.users || []).forEach((authUser) => {
      accounts[authUser.localId] = {
        // Identity Platform returns these as millisecond strings. Passed
        // through as numbers so the client formats them, and 0 rather than
        // null so "never" is one check rather than two.
        createdAt: Number(authUser.createdAt || 0),
        hasPassword: authUserHasPassword(authUser),
        lastSignInAt: Number(authUser.lastLoginAt || 0)
      };
    });
  }

  // A profile with no Auth record at all - every CSV-imported member until
  // their first code - is absent from the response rather than present and
  // empty, so fill it in as never signed in instead of leaving the caller to
  // tell "no record" apart from "not asked for".
  unique.forEach((localId) => {
    if (!accounts[localId]) {
      accounts[localId] = { createdAt: 0, hasPassword: false, lastSignInAt: 0 };
    }
  });

  return accounts;
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
