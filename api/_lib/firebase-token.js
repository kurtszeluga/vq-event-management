import { createPublicKey, createVerify } from 'node:crypto';

const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const CERT_CACHE_TTL_MS = 60 * 60 * 1000;

let cachedCerts = null;
let cachedCertsLoadedAt = 0;

export async function verifyFirebaseIdToken(idToken, projectId) {
  if (!projectId) {
    throw new Error('Firebase project ID is not configured.');
  }

  if (typeof idToken !== 'string' || !idToken) {
    throw new Error('Missing authorization token.');
  }

  const parts = idToken.split('.');

  if (parts.length !== 3) {
    throw new Error('Invalid authorization token.');
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtSegment(encodedHeader);
  const payload = decodeJwtSegment(encodedPayload);

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Invalid authorization token.');
  }

  if (payload.aud !== projectId) {
    throw new Error('Invalid authorization token.');
  }

  if (payload.iss !== `https://securetoken.google.com/${projectId}`) {
    throw new Error('Invalid authorization token.');
  }

  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) {
    throw new Error('Authorization token has expired.');
  }

  const certs = await getFirebaseCerts();
  const certificate = certs[header.kid];

  if (!certificate) {
    throw new Error('Invalid authorization token.');
  }

  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${encodedHeader}.${encodedPayload}`);
  verifier.end();

  const signature = base64UrlToBuffer(encodedSignature);
  const publicKey = createPublicKey(certificate);
  const verified = verifier.verify(publicKey, signature);

  if (!verified) {
    throw new Error('Invalid authorization token.');
  }

  return payload;
}

async function getFirebaseCerts() {
  const now = Date.now();

  if (cachedCerts && now - cachedCertsLoadedAt < CERT_CACHE_TTL_MS) {
    return cachedCerts;
  }

  const response = await fetch(CERTS_URL);

  if (!response.ok) {
    throw new Error('Unable to load Firebase signing certificates.');
  }

  cachedCerts = await response.json();
  cachedCertsLoadedAt = now;
  return cachedCerts;
}

function decodeJwtSegment(segment) {
  return JSON.parse(base64UrlToString(segment));
}

function base64UrlToString(value) {
  return base64UrlToBuffer(value).toString('utf8');
}

function base64UrlToBuffer(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return Buffer.from(normalized + padding, 'base64');
}
