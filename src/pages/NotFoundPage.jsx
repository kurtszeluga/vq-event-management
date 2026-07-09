import { Link } from 'react-router-dom';

function NotFoundPage() {
  return (
    <main className="not-found">
      <h1>Page not found</h1>
      <p>The requested page is not available in the event management app.</p>
      <Link className="button-link" to="/">
        Return home
      </Link>
    </main>
  );
}

export default NotFoundPage;
