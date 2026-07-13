import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const TOKEN_SCOPE = 'https://www.googleapis.com/auth/identitytoolkit';
const TOKEN_CACHE_SAFETY_WINDOW_MS = 60 * 1000;

let cachedAccessToken = '';
let cachedAccessTokenExpiresAt = 0;

export async function getGoogleAccessToken(serviceAccountJson, scope = TOKEN_SCOPE) {
  const serviceAccount = parseServiceAccountJson(serviceAccountJson);

  if (
    cachedAccessToken
    && Date.now() < cachedAccessTokenExpiresAt - TOKEN_CACHE_SAFETY_WINDOW_MS
  ) {
    return cachedAccessToken;
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

  cachedAccessToken = data.access_token || '';
  cachedAccessTokenExpiresAt = Date.now() + ((data.expires_in || 3600) * 1000);

  if (!cachedAccessToken) {
    throw new Error('Google access token was not returned.');
  }

  return cachedAccessToken;
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
