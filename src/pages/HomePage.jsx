import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/useAuth.js';
import { subscribeToPublishedEvents } from '../services/eventService.js';
import { subscribeToUserRegistrations } from '../services/registrationService.js';
import { subscribeToUsers } from '../services/userService.js';
import {
  formatEventDateRange,
  formatTimeRange,
  getEventDateParts,
  getEventTypeToneClass,
  groupEventsByMonth,
  isEventVisible
} from '../utils/eventFormat.js';
import { hasOutstandingWaitlistOffer } from '../utils/registrationEligibility.js';

// Types that are never a thing to sign up for on a season list: the two
// directories, and Membership, which is deliberately reachable only by a
// direct link rather than from any listing.
const SEASON_EXCLUDED_TYPES = new Set(['Business Listing', 'For Sale', 'Membership']);
const SEASON_LIMIT = 8;

function getEventTypeLabel(event) {
  return event.eventType || 'Other';
}

// An event is "still ahead" if its last day has not passed. endDate covers a
// retreat that is part-way through; an event with no date at all - a Challenge
// - stays in, and groups under its own trailing heading.
function isUpcoming(event, todayIso) {
  const lastDay = event?.endDate || event?.date;
  return !lastDay || lastDay >= todayIso;
}

function HomePage() {
  const { currentUser, hasPermission, isSuperUser } = useAuth();
  const navigate = useNavigate();
  const canAddUsers = hasPermission('addUsers');
  const canReviewMemberships = isSuperUser || hasPermission('manageMembershipStatus');
  const hasAdminDashboardAccess =
    isSuperUser || canAddUsers || hasPermission('manageEvents') || hasPermission('managePrograms')
    || hasPermission('manageChallenges') || hasPermission('manageMembershipStatus');
  const [pendingMembershipCount, setPendingMembershipCount] = useState(0);
  const [events, setEvents] = useState([]);
  const [registrations, setRegistrations] = useState([]);

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

  // The season is public: a visitor sees what is coming up and can decide
  // whether joining is worth it. Only the "you are registered" marks and the
  // offer banner need a signed-in reader.
  useEffect(() => subscribeToPublishedEvents(
    (snapshot) => {
      setEvents(snapshot.docs.map((eventDoc) => ({ id: eventDoc.id, ...eventDoc.data() })));
    },
    () => {
      setEvents([]);
    }
  ), []);

  useEffect(() => {
    if (!currentUser?.uid) {
      setRegistrations([]);
      return undefined;
    }

    return subscribeToUserRegistrations(
      currentUser.uid,
      (snapshot) => {
        setRegistrations(snapshot.docs.map((registrationDoc) => ({
          id: registrationDoc.id,
          ...registrationDoc.data()
        })));
      },
      () => {
        setRegistrations([]);
      }
    );
  }, [currentUser]);

  const registrationsByEventId = useMemo(() => {
    const byEventId = new Map();

    registrations.forEach((registration) => {
      if (registration.status === 'Cancelled') {
        return;
      }

      byEventId.set(registration.eventId, registration);
    });

    return byEventId;
  }, [registrations]);

  // Whichever registration is holding an unanswered offer; there is normally
  // at most one, and the banner speaks for the first.
  const waitlistOffer = useMemo(() => {
    const offered = registrations.find(hasOutstandingWaitlistOffer);

    if (!offered) {
      return null;
    }

    return {
      event: events.find((event) => event.id === offered.eventId) || null,
      registration: offered
    };
  }, [events, registrations]);

  const seasonGroups = useMemo(() => {
    const todayIso = new Date().toISOString().slice(0, 10);
    const upcoming = events
      .filter(isEventVisible)
      .filter((event) => !SEASON_EXCLUDED_TYPES.has(getEventTypeLabel(event)))
      .filter((event) => isUpcoming(event, todayIso))
      .slice(0, SEASON_LIMIT);

    return groupEventsByMonth(upcoming);
  }, [events]);

  function openPendingMembershipReview() {
    navigate('/admin', {
      state: {
        module: 'user-controls',
        userControlsMembershipFilter: 'Pending',
        userControlsQuickFilter: 'pending-review'
      }
    });
  }

  // Admins used to get the dashboard rendered here in place of the home page.
  // They now land on the same home page as everyone else and reach the
  // dashboard from the nav link (see navDestinations in App.jsx) or the panel
  // in the side column.
  return (
    <section>
      {/* The page title lives in the hero band above the page column (see
          HomeHero.jsx, rendered from App.jsx on this route only), so repeating
          a PageHeader here would state the guild's name twice in a row. */}

      {/* A seat that is waiting on an answer is the one thing on this page
          with a deadline, so it sits above everything else. The claim itself
          happens through the link in the email - that link carries the token
          the server checks - so this says where to find it rather than
          offering a button that could not work. */}
      {waitlistOffer ? (
        <div className="home-attention">
          <span aria-hidden="true" className="home-attention-dot" />
          <div className="home-attention-copy">
            <strong>A seat has opened up for {waitlistOffer.event?.title || 'an activity you are waiting for'}.</strong>
            <span>
              The claim link is in your email. If you do not answer it, the seat passes to the next
              person on the waitlist.
            </span>
          </div>
          <Link className="button-link secondary-action" to="/my-registrations">
            See my registrations
          </Link>
        </div>
      ) : null}

      <div className="home-layout">
        <div className="home-season">
          <div className="home-season-head">
            <h2>What&rsquo;s coming up</h2>
            <Link to="/events">See all activities</Link>
          </div>

          {seasonGroups.length ? (
            <div className="home-season-list">
              {seasonGroups.map((group) => (
                <Fragment key={group.key}>
                  <h3 className="event-month-heading">
                    <span>{group.label}</span>
                    <span className="event-month-count">
                      {group.events.length} {group.events.length === 1 ? 'activity' : 'activities'}
                    </span>
                  </h3>
                  {group.events.map((event) => {
                    const registration = registrationsByEventId.get(event.id);
                    const dateParts = getEventDateParts(event.date);
                    const timeRange = formatTimeRange(event.startTime, event.endTime);

                    return (
                      <article
                        className={`home-season-row ${getEventTypeToneClass(getEventTypeLabel(event))}`}
                        key={event.id}
                      >
                        <span aria-hidden="true" className="home-season-date">
                          {dateParts ? (
                            <>
                              <span className="home-season-month">{dateParts.month}</span>
                              <span className="home-season-day">{dateParts.day}</span>
                            </>
                          ) : (
                            <span className="home-season-month">TBD</span>
                          )}
                        </span>
                        <span className="home-season-copy">
                          <Link to="/events">{event.title}</Link>
                          <span className="home-season-meta">
                            <span>{getEventTypeLabel(event)}</span>
                            {dateParts ? <span>{formatEventDateRange(event)}</span> : null}
                            {timeRange ? <span>{timeRange}</span> : null}
                          </span>
                        </span>
                        {registration ? (
                          <span className="home-season-mine">You are registered</span>
                        ) : null}
                      </article>
                    );
                  })}
                </Fragment>
              ))}
            </div>
          ) : (
            <p className="form-help home-season-empty">
              Nothing is on the calendar just now. New activities appear here as soon as they are
              published.
            </p>
          )}
        </div>

        <aside className="home-side">
          {canReviewMemberships ? (
            <section className={`home-side-panel${pendingMembershipCount ? ' pending-home-card' : ''}`}>
              <h2>Pending Membership Reviews</h2>
              <p>
                {pendingMembershipCount
                  ? `${pendingMembershipCount} membership ${pendingMembershipCount === 1 ? 'profile is' : 'profiles are'} waiting for review.`
                  : 'No membership profiles are waiting for review right now.'}
              </p>
              {/* Teal like every other button on this page; amber only while
                  reviews are actually waiting, matching the panel's border. */}
              <button
                className={`button-link button-reset${pendingMembershipCount ? ' pending-review-button' : ''}`}
                type="button"
                onClick={openPendingMembershipReview}
              >
                Open Pending Review
              </button>
            </section>
          ) : null}

          {hasAdminDashboardAccess ? (
            <section className="home-side-panel">
              <h2>Admin Dashboard</h2>
              <p>Manage events, listings, users, challenges, and configuration tools.</p>
              <button
                className="button-link button-reset"
                type="button"
                onClick={() => navigate('/admin')}
              >
                Open Admin Dashboard
              </button>
            </section>
          ) : null}

          {/* The two directories are not activities, so they do not belong in
              the season - but they were reachable from this page before and
              should stay reachable from it. */}
          <section className="home-side-panel">
            <h2>Also here</h2>
            <ul className="home-side-links">
              <li><Link to="/business-listings">Business Listings</Link></li>
              <li><Link to="/for-sale">For Sale</Link></li>
              {currentUser ? <li><Link to="/my-registrations">My Registrations</Link></li> : null}
            </ul>
          </section>

          {!currentUser ? (
            <section className="home-side-panel home-join-panel">
              <h2>Need to become a member?</h2>
              <p>Sign in or start a membership signup to reach member pricing and member features.</p>
              <div className="card-actions home-card-actions">
                <Link className="button-link" to="/login">
                  Sign In
                </Link>
                <Link className="button-link secondary-action" to="/signup">
                  Become A Member
                </Link>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </section>
  );
}

export default HomePage;
