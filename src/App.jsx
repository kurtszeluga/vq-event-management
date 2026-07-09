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

  return (
    <div className="app-shell">
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

export default App;
