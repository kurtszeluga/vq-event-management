const ALLOWED_HOSTS = new Set([
  'firebasestorage.googleapis.com',
  'storage.googleapis.com'
]);

export default async function handler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
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

    const upstreamHeaders = {};
    const rangeHeader = request.headers.range;

    if (rangeHeader) {
      upstreamHeaders.Range = rangeHeader;
    }

    const upstream = await fetch(parsedUrl.toString(), {
      headers: upstreamHeaders,
      method: request.method === 'HEAD' ? 'HEAD' : 'GET'
    });

    if (!upstream.ok) {
      response.status(upstream.status).json({ error: 'Unable to load file.' });
      return;
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const safeDisposition = disposition === 'attachment' ? 'attachment' : 'inline';
    const safeFileName = sanitizeFileName(Array.isArray(filename) ? filename[0] : filename);
    const statusCode = upstream.status === 206 ? 206 : 200;

    response.setHeader('Content-Type', contentType);
    response.setHeader(
      'Content-Disposition',
      `${safeDisposition}; filename="${safeFileName || 'download.pdf'}"`
    );
    response.setHeader('Accept-Ranges', upstream.headers.get('accept-ranges') || 'bytes');
    copyHeader(upstream, response, 'Content-Length');
    copyHeader(upstream, response, 'Content-Range');
    response.setHeader('Cache-Control', 'private, max-age=0, no-cache, no-store, must-revalidate');

    if (request.method === 'HEAD') {
      response.status(statusCode).end();
      return;
    }

    const body = Buffer.from(await upstream.arrayBuffer());
    response.status(statusCode).send(body);
  } catch (error) {
    response.status(500).json({ error: error.message });
  }
}

function copyHeader(upstream, response, headerName) {
  const value = upstream.headers.get(headerName.toLowerCase());

  if (value) {
    response.setHeader(headerName, value);
  }
}

function sanitizeFileName(value) {
  return String(value || '')
    .trim()
    .replace(/["\r\n]/g, '')
    .replace(/[\\/]+/g, '-');
}
