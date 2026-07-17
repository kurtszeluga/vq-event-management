export default function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  const applicationId = process.env.SQUARE_APPLICATION_ID || '';
  const locationId = process.env.SQUARE_LOCATION_ID || '';
  const environment = process.env.SQUARE_ENVIRONMENT === 'production' ? 'production' : 'sandbox';

  response.status(200).json({
    applicationId,
    enabled: Boolean(applicationId && locationId),
    environment,
    locationId,
    scriptUrl: environment === 'production'
      ? 'https://web.squarecdn.com/v1/square.js'
      : 'https://sandbox.web.squarecdn.com/v1/square.js'
  });
}
