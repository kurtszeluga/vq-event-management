import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';

function NotFoundPage() {
  const error = useRouteError();
  const isRouteNotFound = isRouteErrorResponse(error) && error.status === 404;
  const hasAppError = error && !isRouteNotFound;
  const message = hasAppError
    ? error.message || 'The page could not be loaded.'
    : 'The requested page is not available in the event management app.';

  return (
    <main className="not-found">
      <h1>{hasAppError ? 'Page Error' : 'Page not found'}</h1>
      <p>{message}</p>
      <Link className="button-link" to="/">
        Return home
      </Link>
    </main>
  );
}

export default NotFoundPage;
