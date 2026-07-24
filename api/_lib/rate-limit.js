import { createHash } from 'node:crypto';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const DEFAULT_WINDOW_MS = 10 * 60 * 1000;

export function getClientRateLimitKey(request) {
  const forwardedFor = String(request.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const realIp = String(request.headers['x-real-ip'] || '').trim();
  const socketIp = request.socket?.remoteAddress || '';

  return forwardedFor || realIp || socketIp || 'unknown-client';
}

export async function enforceRateLimit(db, {
  keyParts = [],
  limit = 60,
  message = 'Too many requests. Please wait a moment and try again.',
  request = null,
  scope,
  windowMs = DEFAULT_WINDOW_MS
}) {
  if (process.env.DISABLE_API_RATE_LIMITS === 'true') {
    return;
  }

  const cleanedScope = cleanPart(scope);

  if (!cleanedScope) {
    throw new Error('Rate limit scope is required.');
  }

  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;
  const requestKey = request ? getClientRateLimitKey(request) : '';
  const rawKey = [
    cleanedScope,
    windowStart,
    requestKey,
    ...keyParts.map(cleanPart)
  ].filter(Boolean).join('|');
  const rateLimitId = createHash('sha256').update(rawKey).digest('hex');
  const rateLimitRef = db.collection('apiRateLimits').doc(rateLimitId);

  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(rateLimitRef);
    const currentCount = snapshot.exists ? Number(snapshot.data().count || 0) : 0;

    if (currentCount >= limit) {
      const error = new Error(message);

      error.statusCode = 429;
      error.retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
      throw error;
    }

    transaction.set(rateLimitRef, {
      count: currentCount + 1,
      expiresAt: Timestamp.fromMillis(windowStart + (windowMs * 2)),
      lastSeenAt: FieldValue.serverTimestamp(),
      scope: cleanedScope,
      windowStart: Timestamp.fromMillis(windowStart),
      windowMs
    }, { merge: true });
  });
}

function cleanPart(value) {
  return String(value || '').trim().toLowerCase().slice(0, 160);
}
