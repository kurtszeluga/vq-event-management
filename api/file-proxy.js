const ALLOWED_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com'
]);

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    response.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  try {
    const { url, disposition = 'inline', filename = 'download.pdf' } = request.query || {};
    const fileUrl = Array.isArray(url) ? url[0] : url;

    if (!fileUrl || typeof fileUrl !== 'string') {
      response.status(400).json({ error: 'Missing file URL.' });
      return;
    }

    const parsedUrl = new URL(fileUrl);

    if (!ALLOWED_HOSTS.has(parsedUrl.hostname)) {
      response.status(400).json({ error: 'Unsupported file host.' });
      return;
    }

    const upstream = await fetch(parsedUrl.toString());

    if (!upstream.ok) {
      response.status(upstream.status).json({ error: 'Unable to load file.' });
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const safeDisposition = disposition === 'attachment' ? 'attachment' : 'inline';
    const safeFileName = sanitizeFileName(Array.isArray(filename) ? filename[0] : filename);
    const body = Buffer.from(await upstream.arrayBuffer());

    response.setHeader('Content-Type', contentType);
    response.setHeader(
      'Content-Disposition',
      `${safeDisposition}; filename="${safeFileName || 'download.pdf'}"`
    );
    response.setHeader('Cache-Control', 'private, max-age=0, no-cache, no-store, must-revalidate');
    response.status(200).send(body);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}

function sanitizeFileName(value) {
  return String(value || '')
    .trim()
    .replace(/["\r\n]/g, '')
    .replace(/[\\/]+/g, '-');
}
