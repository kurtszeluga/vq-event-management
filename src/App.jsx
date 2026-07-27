import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import MobileNavSheet from './components/MobileNavSheet.jsx';
import { useAuth } from './context/useAuth.js';
import { getAccountDisplayName } from './utils/profileFormat.js';

function App() {
  const location = useLocation();
  const { currentUser, hasPermission, isAdmin, isSuperUser, logOut, userProfile } = useAuth();
  const [navSheetOpen, setNavSheetOpen] = useState(false);
  const menuButtonRef = useRef(null);
  const normalizedPath = location.pathname.replace(/\/+$/, '');
  const isPopupMode =
    normalizedPath.endsWith('/supply-list') || normalizedPath.endsWith('/print');
  const pullState = usePullToRefresh(isPopupMode);
  const showAdminSignupLink =
    currentUser
    && (isSuperUser
      || hasPermission('addUsers')
      || hasPermission('manageEvents')
      || hasPermission('manageMembershipStatus')
      || hasPermission('viewRegistrations'));
  const showMemberDirectoryLink =
    currentUser
    && userHasActiveMembership(userProfile);
  const currentYear = new Date().getFullYear();
  // One list feeding both the desktop nav row and the mobile sheet, so the two
  // cannot drift apart as permissions change.
  const navDestinations = [
    { to: '/', label: 'Home', end: true, visible: true },
    { to: '/login', label: 'Login', visible: !currentUser },
    { to: '/events', label: 'Programs/Activities Signup', visible: showAdminSignupLink },
    { to: '/my-registrations', label: 'My Registrations', visible: true },
    { to: '/member-directory', label: 'Member Directory', visible: showMemberDirectoryLink },
    { to: '/profile', label: 'My Profile', visible: Boolean(currentUser) }
  ].filter((destination) => destination.visible);

  function closeNavSheet() {
    setNavSheetOpen(false);
    // Focus goes back to the control that opened the sheet, or it would land on
    // document.body and a keyboard user would lose their place.
    menuButtonRef.current?.focus();
  }

  useEffect(() => {
    document.body.classList.toggle('popup-mode', isPopupMode);

    return () => {
      document.body.classList.remove('popup-mode');
    };
  }, [isPopupMode]);

  if (isPopupMode) {
    return (
      <div className="app-shell popup-shell">
        <main className="page-content popup-content">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div
        aria-live="polite"
        className={`pull-refresh-indicator ${
          pullState.ready ? 'ready' : ''
        } ${pullState.refreshing ? 'refreshing' : ''}`}
        style={{ transform: `translateY(${pullState.offset}px)` }}
      >
        {pullState.refreshing
          ? 'Refreshing...'
          : pullState.ready
            ? 'Release To Refresh'
            : 'Pull To Refresh'}
      </div>
      <header className="site-header">
        <a className="brand" href="/">
          <img
            alt="The Village Quilters"
            className="brand-logo"
            src="/assets/village-quilters-logo.png"
          />
          <strong>The Village Quilters</strong>
        </a>
        <nav className="site-nav" aria-label="Primary navigation">
          {navDestinations.map((destination) => (
            <NavLink
              className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
              end={destination.end}
              key={destination.to}
              to={destination.to}
            >
              {destination.label}
            </NavLink>
          ))}
        </nav>
        {currentUser ? (
          <div className="site-identity">
            <span aria-hidden="true" className="site-identity-avatar">
              {getInitials(currentUser, userProfile)}
            </span>
            <span className="site-identity-text">
              {getAccountDisplayName(currentUser, userProfile) ? (
                <strong>{getAccountDisplayName(currentUser, userProfile)}</strong>
              ) : null}
              <span>{currentUser.email}</span>
            </span>
            <span className="site-identity-role">{isAdmin ? 'Admin' : 'Signed in'}</span>
            <button className="site-identity-signout" type="button" onClick={logOut}>
              Sign out
            </button>
          </div>
        ) : null}
        <button
          aria-expanded={navSheetOpen}
          aria-haspopup="dialog"
          aria-label="Open menu"
          className="site-menu-button"
          ref={menuButtonRef}
          type="button"
          onClick={() => setNavSheetOpen(true)}
        >
          <span aria-hidden="true" className="site-menu-bars" />
        </button>
      </header>
      <MobileNavSheet
        currentUser={currentUser}
        destinations={navDestinations}
        isAdmin={isAdmin}
        open={navSheetOpen}
        userProfile={userProfile}
        onClose={closeNavSheet}
        onSignOut={logOut}
      />
      <main className="page-content">
        <Outlet />
      </main>
      <footer className="site-footer">
        <div>
          <strong>The Village Quilters, Inc.</strong>
          <span>145 Awohili Drive, Loudon TN 37774</span>
        </div>
        <nav aria-label="Footer navigation">
          <span>&copy; {currentYear} The Village Quilters, Inc.</span>
          <Link to="/terms">Terms</Link>
          <Link to="/privacy">Privacy</Link>
          <Link to="/support">Support</Link>
        </nav>
      </footer>
    </div>
  );
}

function userHasActiveMembership(profile) {
  return profile?.status === 'Active' && profile?.membershipStatus === 'Active';
}

function getInitials(currentUser, userProfile) {
  const name = getAccountDisplayName(currentUser, userProfile);

  if (name) {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('');
  }

  return (currentUser?.email || '?')[0].toUpperCase();
}

function usePullToRefresh(disabled = false) {
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const readyRef = useRef(false);
  const [offset, setOffset] = useState(-64);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (disabled) {
      return undefined;
    }

    const maxPull = 118;
    const refreshThreshold = 58;

    function handleTouchStart(event) {
      if (
        !isMobileViewport() ||
        !isAtPageTop() ||
        isInteractive(event.target) ||
        event.touches.length !== 1
      ) {
        pullingRef.current = false;
        return;
      }

      readyRef.current = false;
      startXRef.current = event.touches[0].clientX;
      startYRef.current = event.touches[0].clientY;
      pullingRef.current = true;
    }

    function handleTouchMove(event) {
      if (!pullingRef.current || refreshing) {
        return;
      }

      const touch = event.touches[0];
      const pullDistance = touch.clientY - startYRef.current;
      const sideDistance = Math.abs(touch.clientX - startXRef.current);

      if (sideDistance > Math.max(22, pullDistance * 0.85)) {
        pullingRef.current = false;
        readyRef.current = false;
        setOffset(-64);
        setReady(false);
        return;
      }

      if (pullDistance <= 0) {
        readyRef.current = false;
        setOffset(-64);
        setReady(false);
        return;
      }

      event.preventDefault();
      const dampenedPull = Math.min(maxPull, Math.round(pullDistance * 0.62));
      const nextReady = dampenedPull >= refreshThreshold;
      readyRef.current = nextReady;
      setOffset(dampenedPull - 64);
      setReady(nextReady);
    }

    function handleTouchEnd() {
      if (!pullingRef.current) {
        return;
      }

      pullingRef.current = false;

      if (readyRef.current) {
        setRefreshing(true);
        setOffset(18);
        window.setTimeout(() => window.location.reload(), 180);
      } else {
        readyRef.current = false;
        setOffset(-64);
        setReady(false);
      }
    }

    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [disabled, refreshing]);

  return { offset, ready, refreshing };
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
}

function isAtPageTop() {
  const scrollTop =
    window.scrollY ||
    document.documentElement.scrollTop ||
    document.body.scrollTop ||
    0;

  return scrollTop <= 8;
}

function isInteractive(target) {
  return Boolean(
    target?.closest?.('input, textarea, select, button, a, [role="button"]')
  );
}

export default App;
