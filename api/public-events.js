import { getFirestore } from 'firebase-admin/firestore';
import { getFeedCategory, initializeAdminApp, loadPublicFeed } from './_lib/public-event-feed.js';
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
    await enforceRateLimit(getFirestore(), {
      limit: 120,
      message: 'Too many requests. Please wait and try again later.',
      request,
      scope: 'public-events-ip',
      windowMs: 10 * 60 * 1000
    });

    const category = getFeedCategory(request.query.category);
    const origin = getRequestOrigin(request);
    const payload = await loadPublicFeed(category, origin);

    response.status(200).json(payload);
  } catch (error) {
    response.status(error.statusCode || 500).json({
      error: error.message || 'Unable to load public events.'
    });
  }
}

function getRequestOrigin(request) {
  const forwardedProto = request.headers['x-forwarded-proto'] || 'https';
  const forwardedHost = request.headers['x-forwarded-host'] || request.headers.host || '';
  return `${forwardedProto}://${forwardedHost}`;
}
