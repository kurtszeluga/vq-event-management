import { useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import { getAccountDisplayName } from '../utils/profileFormat.js';

// The phone-width site menu. The sticky header used to stack every destination
// as its own bordered pill, which cost roughly 470px of an 812px viewport before
// any page content. Those destinations live here instead, behind the header's
// menu button, grouped into one card with inset dividers rather than six
// separate boxes with gaps between them.
//
// This is a modal dialog, so it owns the behaviour that goes with one: Escape
// closes it, focus moves in on open and is trapped while it is open, the page
// behind it cannot scroll, and the caller restores focus to the button that
// opened it. PROJECT_UPGRADE.md's "consistent keyboard focus and dialog focus
// management" row is the same requirement.
function MobileNavSheet({ currentUser, destinations, isAdmin, onClose, onSignOut, open, userProfile }) {
  const closeButtonRef = useRef(null);
  const sheetRef = useRef(null);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    closeButtonRef.current?.focus();
    document.body.classList.add('nav-sheet-open');

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') {
        return;
      }

      // Keep Tab inside the sheet. Without this, tabbing walks into the page
      // behind the overlay, where the focus ring is invisible.
      const focusable = sheetRef.current?.querySelectorAll(
        'a[href], button:not([disabled])'
      );

      if (!focusable?.length) {
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.classList.remove('nav-sheet-open');
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="nav-sheet-layer">
      {/* Backdrop is a button so a pointer tap closes the sheet without adding
          a click handler to a div. It is hidden from the accessibility tree
          because Escape and the close button already cover keyboard users. */}
      <button
        aria-hidden="true"
        className="nav-sheet-backdrop"
        tabIndex={-1}
        type="button"
        onClick={onClose}
      />
      <div
        aria-label="Site menu"
        aria-modal="true"
        className="nav-sheet"
        ref={sheetRef}
        role="dialog"
      >
        <div className="nav-sheet-top">
          <button
            aria-label="Close menu"
            className="nav-sheet-close"
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
          >
            <span aria-hidden="true" className="nav-sheet-close-mark" />
          </button>
        </div>

        {currentUser ? (
          <div className="nav-sheet-card nav-sheet-account">
            {getAccountDisplayName(currentUser, userProfile) ? (
              <span className="nav-sheet-account-name">
                {getAccountDisplayName(currentUser, userProfile)}
              </span>
            ) : null}
            <span className="nav-sheet-account-email">{currentUser.email}</span>
            <span className="nav-sheet-account-role">
              {isAdmin ? 'Admin' : 'Signed in'}
            </span>
          </div>
        ) : null}

        <nav aria-label="Site menu navigation">
          <div className="nav-sheet-card">
            {destinations.map((destination) => (
              <NavLink
                className={({ isActive }) =>
                  isActive ? 'nav-sheet-row active' : 'nav-sheet-row'
                }
                end={destination.end}
                key={destination.to}
                to={destination.to}
                onClick={onClose}
              >
                <span>{destination.label}</span>
                <span aria-hidden="true" className="nav-sheet-chevron" />
              </NavLink>
            ))}
          </div>
        </nav>

        {currentUser ? (
          <div className="nav-sheet-card">
            <button
              className="nav-sheet-row nav-sheet-row-button"
              type="button"
              onClick={() => {
                onClose();
                onSignOut();
              }}
            >
              <span>Sign out</span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default MobileNavSheet;
