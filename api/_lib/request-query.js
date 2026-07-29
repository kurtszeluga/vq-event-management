export function parseRequestQuery(request) {
  return new URL(request.url, 'http://localhost').searchParams;
}
