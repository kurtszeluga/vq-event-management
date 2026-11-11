import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';
const TOKEN_CACHE_SAFETY_WINDOW_MS = 60 * 1000;

// Keyed by service account AND scope, not a single slot. A token is only valid
// for the scopes it was minted with, so a lone cached token meant the second
// caller to ask for a different scope was handed the first caller's token and
// got a 403 it could not explain - or poisoned the cache for the caller that
// came after it. There is more than one scope in play since the registration
// sheet sync (api/_lib/event-registration-sheet.js) needs Drive and Sheets
// while everything else here needs identitytoolkit.
const tokenCache = new Map();

export async function getGoogleAccessToken(serviceAccountJson, scope = TOKEN_SCOPE) {
  const serviceAccount = parseServiceAccountJson(serviceAccountJson);
  const cacheKey = `${serviceAccount.client_email}|${scope}`;
  const cached = tokenCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt - TOKEN_CACHE_SAFETY_WINDOW_MS) {
    return cached.accessToken;
  }

  const assertion = createServiceAccountAssertion(serviceAccount, scope);
  const response = await fetch(TOKEN_URL, {
    body: new URLSearchParams({
      assertion,
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer'
    }),
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    method: 'POST'
  });

  const text = await response.text();
  const data = text ? safeJsonParse(text) : {};

  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Unable to obtain Google access token.');
  }

  const accessToken = data.access_token || '';

  if (!accessToken) {
    throw new Error('Google access token was not returned.');
  }

  tokenCache.set(cacheKey, {
    accessToken,
    expiresAt: Date.now() + ((data.expires_in || 3600) * 1000)
  });

  return accessToken;
}

function createServiceAccountAssertion(serviceAccount, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({
    alg: 'RS256',
    typ: 'JWT'
  }));
  const payload = encodeBase64Url(JSON.stringify({
    aud: TOKEN_URL,
    exp: now + 3600,
    iat: now,
    iss: serviceAccount.client_email,
    scope,
    sub: serviceAccount.client_email
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  signer.end();

  const signature = signer.sign(serviceAccount.private_key, 'base64url');
  return `${header}.${payload}.${signature}`;
}

function parseServiceAccountJson(serviceAccountJson) {
  const trimmed = String(serviceAccountJson || '').trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    return JSON.parse(Buffer.from(trimmed, 'base64').toString('utf8'));
  }
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
