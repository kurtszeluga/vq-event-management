import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export default function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).send('Method not allowed.');
    return;
  }

  const scriptPath = join(process.cwd(), 'public', 'godaddy-event-feed.js');
  const script = readFileSync(scriptPath, 'utf8');

  response.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  response.setHeader('Cache-Control', 'private, max-age=0, no-cache, no-store, must-revalidate');
  response.status(200).send(script);
}
