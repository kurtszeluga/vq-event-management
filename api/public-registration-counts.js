import { getFirestore } from 'firebase-admin/firestore';
import {
  initializeAdminApp,
  loadRegistrationCounts
} from './_lib/public-event-feed.js';
import { parseRequestQuery } from './_lib/request-query.js';
import { enforceRateLimit } from './_lib/rate-limit.js';

export default async function handler(request, response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.setHeader('Cache-Control', 'private, max-age=0, no-cache, no-store, must-revalidate');

  if (request.method === 'OPTIONS') {
    response.status(204).end();
    return;
  }

  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET, OPTIONS');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    initializeAdminApp();
    const db = getFirestore();

    await enforceRateLimit(db, {
      limit: 120,
      message: 'Too many requests.',
      request,
      scope: 'public-registration-counts-ip',
      windowMs: 10 * 60 * 1000
    });

    const eventIds = String(parseRequestQuery(request).get('eventIds') || '')
      .split(',')
      .map((eventId) => eventId.trim())
      .filter(Boolean);

    const counts = await loadRegistrationCounts(db, eventIds);

    response.status(200).json({ counts });
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Unable to load registration counts.'
    });
  }
}
