import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader.jsx';
import { useAuth } from '../context/useAuth.js';
import AdminDashboardPage from './AdminDashboardPage.jsx';
import { subscribeToUsers } from '../services/userService.js';

function HomePage() {
  const { currentUser, hasPermission, isSuperUser } = useAuth();
  const navigate = useNavigate();
  const canAddUsers = hasPermission('addUsers');
  const canReviewMemberships = isSuperUser || hasPermission('manageMembershipStatus');
  const hasAdminDashboardAccess =
    isSuperUser || canAddUsers || hasPermission('manageEvents') || hasPermission('manageMembershipStatus');
  const [pendingMembershipCount, setPendingMembershipCount] = useState(0);

  useEffect(() => {
    if (!currentUser || !canReviewMemberships) {
      setPendingMembershipCount(0);
      return undefined;
    }

    const unsubscribe = subscribeToUsers(
      (snapshot) => {
        const pendingCount = snapshot.docs
          .map((userDoc) => userDoc.data())
          .filter((user) => user.role !== 'Super User' && user.membershipStatus === 'Pending').length;
        setPendingMembershipCount(pendingCount);
      },
      () => {
        setPendingMembershipCount(0);
      },
      { includeAdminProfiles: false }
    );

    return unsubscribe;
  }, [canReviewMemberships, currentUser]);

  function openPendingMembershipReview() {
    navigate('/admin', {
      state: {
        module: 'user-controls',
        userControlsMembershipFilter: 'Pending',
        userControlsQuickFilter: 'pending-review'
      }
    });
  }

  if (currentUser && hasAdminDashboardAccess) {
    return <AdminDashboardPage />;
  }

  return (
    <section>
      <PageHeader
        eyebrow="Home"
        title="The Village Quilters Network"
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
          <p>Browse published classes, workshops, lectures, retreats, and other activities.</p>
          <div className="card-actions home-card-actions">
            <Link className="button-link" to="/events">
              View Events / Activities
            </Link>
          </div>
        </article>

        <article className="home-card">
          <h2>Business Listings</h2>
          <p>Browse the public business directory and quilting-related services.</p>
          <div className="card-actions home-card-actions">
            <Link className="button-link" to="/business-listings">
              View Business Listings
            </Link>
          </div>
        </article>

        <article className="home-card">
          <h2>For Sale</h2>
          <p>See current for-sale postings from guild members and related listings.</p>
          <div className="card-actions home-card-actions">
            <Link className="button-link" to="/for-sale">
              View For Sale
            </Link>
          </div>
        </article>

        {canReviewMemberships ? (
          <article className={`home-card${pendingMembershipCount ? ' pending-home-card' : ''}`}>
            <h2>Pending Membership Reviews</h2>
            <p>
              {pendingMembershipCount
                ? `${pendingMembershipCount} membership ${pendingMembershipCount === 1 ? 'profile is' : 'profiles are'} waiting for review.`
                : 'No membership profiles are waiting for review right now.'}
            </p>
            <div className="card-actions home-card-actions">
              <button
                className={`button-link button-reset${pendingMembershipCount ? ' pending-review-button' : ' secondary-action'}`}
                type="button"
                onClick={openPendingMembershipReview}
              >
                Open Pending Review
              </button>
            </div>
          </article>
        ) : null}

        {hasAdminDashboardAccess ? (
          <article className="home-card">
            <h2>Admin Dashboard</h2>
            <p>Open the admin workspace to manage events, listings, users, challenges, and configuration tools.</p>
            <div className="card-actions home-card-actions">
              <button
                className="button-link button-reset secondary-action"
                type="button"
                onClick={() => navigate('/admin')}
              >
                Open Admin Dashboard
              </button>
            </div>
          </article>
        ) : null}
      </div>

      {!currentUser ? (
        <div className="empty-state home-sign-in-callout">
          <h2>Need to become a member?</h2>
          <p>Sign in or start a membership signup to access member features and any admin tools you are allowed to use.</p>
          <div className="card-actions home-card-actions">
            <Link className="button-link" to="/login">
              Sign In
            </Link>
            <Link className="button-link secondary-action" to="/signup">
              Become A Member
            </Link>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export default HomePage;
