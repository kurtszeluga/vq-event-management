import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from './context/useAuth.js';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/events', label: 'Events' },
  { to: '/register', label: 'Register' },
  { to: '/login', label: 'Login' },
  { to: '/admin', label: 'Admin' }
];

function App() {
  const { currentUser, isAdmin, logOut } = useAuth();
  const pullState = usePullToRefresh();

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
          <span className="brand-mark">VQ</span>
          <span>
            <strong>VQ Event Management</strong>
            <small>Village Quilters programs and classes</small>
          </span>
        </a>
        <nav className="site-nav" aria-label="Primary navigation">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                isActive ? 'nav-link active' : 'nav-link'
              }
              end={item.to === '/'}
            >
              {item.label}
            </NavLink>
          ))}
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

function usePullToRefresh() {
  const startYRef = useRef(0);
  const pullingRef = useRef(false);
  const readyRef = useRef(false);
  const [offset, setOffset] = useState(-64);
  const [ready, setReady] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const maxPull = 112;
    const refreshThreshold = 82;

    function handleTouchStart(event) {
      if (!isMobileViewport() || window.scrollY > 0 || isInteractive(event.target)) {
        pullingRef.current = false;
        return;
      }

      startYRef.current = event.touches[0].clientY;
      pullingRef.current = true;
    }

    function handleTouchMove(event) {
      if (!pullingRef.current || refreshing) {
        return;
      }

      const pullDistance = event.touches[0].clientY - startYRef.current;

      if (pullDistance <= 0) {
        readyRef.current = false;
        setOffset(-64);
        setReady(false);
        return;
      }

      event.preventDefault();
      const dampenedPull = Math.min(maxPull, Math.round(pullDistance * 0.55));
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
  }, [refreshing]);

  return { offset, ready, refreshing };
}

function isMobileViewport() {
  return window.matchMedia('(max-width: 768px), (pointer: coarse)').matches;
}

function isInteractive(target) {
  return Boolean(
    target?.closest?.('input, textarea, select, button, a, [role="button"]')
  );
}

export default App;
