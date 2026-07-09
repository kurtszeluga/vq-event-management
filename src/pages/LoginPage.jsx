import PageHeader from '../components/PageHeader.jsx';
import { firebaseConfigured } from '../lib/firebase.js';

function LoginPage() {
  return (
    <section>
      <PageHeader
        eyebrow="Authentication"
        title="Administrator login"
        description="Firebase Authentication is wired for configuration and will support secure administrator access in Phase 2."
      />
      <div className="status-panel">
        <span className={firebaseConfigured ? 'status-dot good' : 'status-dot'} />
        <span>
          Firebase environment configuration is{' '}
          <strong>{firebaseConfigured ? 'present' : 'not set locally'}</strong>.
        </span>
      </div>
    </section>
  );
}

export default LoginPage;
