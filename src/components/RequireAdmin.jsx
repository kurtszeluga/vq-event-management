import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';

function RequireAdmin({ children }) {
  const { currentUser, firebaseConfigured, isAdmin, loading, profileError } =
    useAuth();
  const location = useLocation();

  if (!firebaseConfigured) {
    return (
      <div className="empty-state">
        <h2>Admin tools aren&apos;t available right now</h2>
        <p>Please try again later or contact support.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="empty-state">
        <h2>Checking access</h2>
        <p>Verifying your administrator permissions.</p>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  if (!isAdmin) {
    return (
      <div className="empty-state">
        <h2>Administrator access required</h2>
        <p>
          {profileError ||
            'This account is signed in, but it is not an active administrator.'}
        </p>
      </div>
    );
  }

  return children;
}

export default RequireAdmin;
