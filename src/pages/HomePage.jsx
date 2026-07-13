import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';

function HomePage() {
  const { currentUser, hasPermission, isSuperUser } = useAuth();
  const navigate = useNavigate();
  const canManageEvents = hasPermission('manageEvents');
  const canAddUsers = hasPermission('addUsers');

  function openAdminModule(module) {
    navigate('/admin', { state: { module } });
  }

  return (
    <section>
      <PageHeader
        eyebrow="Home"
        title="Village Quilters event Management"
        description="Use the cards below to jump into the part of the site you need."
      />

      {currentUser ? (
        <div className="status-panel">
          <span className="status-dot good" />
          <span>
            Signed in as <strong>{currentUser.displayName || currentUser.email}</strong>.
          </span>
        </div>
      ) : null}

      <div className="feature-grid home-grid">
        <article className="home-card">
          <h2>Events / Activities</h2>
          <p>Browse published events or jump straight into event management if you have access.</p>
          <div className="card-actions home-card-actions">
            {canManageEvents ? (
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => openAdminModule('events-activities')}
              >
                Manage Events / Activities
              </button>
            ) : (
              <Link className="button-link" to="/events">
                View Events / Activities
              </Link>
            )}
          </div>
        </article>

        <article className="home-card">
          <h2>Business Listings</h2>
          <p>View the public business directory or manage listings if you are authorized.</p>
          <div className="card-actions home-card-actions">
            {canManageEvents ? (
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => openAdminModule('business-listings')}
              >
                Manage Business Listings
              </button>
            ) : (
              <Link className="button-link" to="/business-listings">
                View Business Listings
              </Link>
            )}
          </div>
        </article>

        <article className="home-card">
          <h2>For Sale</h2>
          <p>See current for-sale postings or manage them from the admin side.</p>
          <div className="card-actions home-card-actions">
            {canManageEvents ? (
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => openAdminModule('for-sale')}
              >
                Manage For Sale
              </button>
            ) : (
              <Link className="button-link" to="/for-sale">
                View For Sale
              </Link>
            )}
          </div>
        </article>

        {canManageEvents ? (
          <article className="home-card">
            <h2>Challenges</h2>
            <p>Open challenge records directly in the admin workspace.</p>
            <div className="card-actions home-card-actions">
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => openAdminModule('challenges')}
              >
                Manage Challenges
              </button>
            </div>
          </article>
        ) : null}

        {isSuperUser || canAddUsers ? (
          <article className="home-card">
            <h2>User Controls</h2>
            <p>Manage profiles, permissions, and account details from one place.</p>
            <div className="card-actions home-card-actions">
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => openAdminModule('user-controls')}
              >
                Open User Controls
              </button>
            </div>
          </article>
        ) : null}

        {isSuperUser ? (
          <article className="home-card">
            <h2>Configuration</h2>
            <p>Manage default locations, times, and member settings.</p>
            <div className="card-actions home-card-actions">
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => openAdminModule('configuration')}
              >
                Open Configuration
              </button>
            </div>
          </article>
        ) : null}
      </div>

      {!currentUser ? (
        <div className="empty-state home-sign-in-callout">
          <h2>Need an account?</h2>
          <p>Sign in or create an account to access member features and any admin tools you are allowed to use.</p>
          <div className="card-actions home-card-actions">
            <Link className="button-link" to="/login">
              Sign In
            </Link>
            <Link className="button-link secondary-action" to="/signup">
              Create Account
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default HomePage;
