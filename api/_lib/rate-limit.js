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
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + windowMs - now) / 1000));
      // The exact wait was already known here and thrown away, leaving every
      // caller to say "later". Windows are fixed rather than rolling, so this
      // is usually far shorter than the window itself - a one-hour limit hit at
      // five to the hour clears in five minutes, and "later" reads like an hour.
      const error = new Error(`${message} ${describeWait(retryAfterSeconds)}`);

      error.statusCode = 429;
      error.retryAfterSeconds = retryAfterSeconds;
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

// Deliberately approximate above a minute. The exact second is noise to
// someone who has to wait, and rounding up never tells them to come back
// before the window has actually turned over.
function describeWait(seconds) {
  if (seconds <= 60) {
    return `Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`;
  }

  // Always rounded up. Rounding down would send someone back before the window
  // had turned over, so they would meet the same refusal again. That also means
  // anything past 60 seconds is at least two minutes - there is no singular
  // case to handle here.
  return `Try again in about ${Math.ceil(seconds / 60)} minutes.`;
}

function cleanPart(value) {
  return String(value || '').trim().toLowerCase().slice(0, 160);
}
