import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './context/useAuth.js';

function App() {
  const location = useLocation();
  const { currentUser, isAdmin, logOut } = useAuth();
  const normalizedPath = location.pathname.replace(/\/+$/, '');
  const isPopupMode =
    normalizedPath.endsWith('/supply-list') || normalizedPath.endsWith('/print');
  const pullState = usePullToRefresh(isPopupMode);

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
          <span>
            <strong>The Village Quilters Network</strong>
            <small>Managing events, activities and members</small>
          </span>
        </a>
        <nav className="site-nav" aria-label="Primary navigation">
          <NavLink
            to="/"
            className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}
            end
          >
            Home
          </NavLink>
          {currentUser ? (
            <NavLink
              to="/profile"
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              My Profile
            </NavLink>
          ) : (
            <NavLink
              to="/login"
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
            >
              Login
            </NavLink>
          )}
          {currentUser ? (
            <button className="nav-button" type="button" onClick={logOut}>
              Sign out
            </button>
          ) : null}
        </nav>
      </header>
      {currentUser ? (
        <div className="auth-banner">
          <span>{currentUser.email}</span>
          <strong>{isAdmin ? 'Admin' : 'Signed in'}</strong>
        </div>
      ) : null}
      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
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
