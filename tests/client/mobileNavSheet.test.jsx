import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import MobileNavSheet from '../../src/components/MobileNavSheet.jsx';

// My Profile is not a destination - it lives in the account card instead (see
// the account-card tests below), matching what App.jsx actually passes.
const DESTINATIONS = [
  { to: '/', label: 'Home', end: true },
  { to: '/my-registrations', label: 'My Registrations' },
  { to: '/member-directory', label: 'Member Directory' }
];

function setup(overrides = {}) {
  const props = {
    currentUser: { email: 'member@example.com' },
    destinations: DESTINATIONS,
    isAdmin: false,
    onClose: vi.fn(),
    onSignOut: vi.fn(),
    open: true,
    ...overrides
  };

  const view = render(
    <MemoryRouter initialEntries={['/my-registrations']}>
      <MobileNavSheet {...props} />
    </MemoryRouter>
  );

  return { props, ...view };
}

function sheet() {
  return screen.getByRole('dialog', { name: 'Site menu' });
}

afterEach(cleanup);

describe('rendering', () => {
  it('renders nothing at all when closed', () => {
    setup({ open: false });

    expect(screen.queryByRole('dialog')).toBeNull();
    // Nothing left behind on the body either, or the page under a closed sheet
    // would stay unscrollable.
    expect(document.body.classList.contains('nav-sheet-open')).toBe(false);
  });

  it('is a labelled modal dialog', () => {
    setup();

    expect(sheet()).toHaveAttribute('aria-modal', 'true');
    expect(sheet()).toHaveAttribute('aria-label', 'Site menu');
  });

  it('lists every destination it is given, in order', () => {
    setup();

    const labels = [...document.querySelectorAll('.nav-sheet-row')]
      .map((row) => row.textContent.trim());

    expect(labels).toEqual([
      'Home',
      'My Registrations',
      'Member Directory',
      'Sign out'
    ]);
  });

  it('marks the current route active', () => {
    setup();

    const active = [...document.querySelectorAll('.nav-sheet-row.active')]
      .map((row) => row.textContent.trim());

    expect(active).toEqual(['My Registrations']);
  });

  it('shows the signed-in email and role', () => {
    setup({ isAdmin: true });

    expect(screen.getByText('member@example.com')).toBeInTheDocument();
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('says "Signed in" rather than "Admin" for a plain member', () => {
    setup({ isAdmin: false });

    expect(screen.getByText('Signed in')).toBeInTheDocument();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('links to /profile from inside the account card, not as a destination row', () => {
    setup();

    const profileLink = screen.getByRole('link', { name: 'My Profile' });
    expect(profileLink).toHaveAttribute('href', '/profile');
    expect(profileLink.closest('.nav-sheet-account')).toBeTruthy();
    expect(profileLink.className).not.toContain('nav-sheet-row');
  });

  it('closes the sheet when the profile link is chosen', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole('link', { name: 'My Profile' }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('shows the profile name above the email when one is available', () => {
    setup({ userProfile: { name: 'Ada Lovelace' } });

    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('member@example.com')).toBeInTheDocument();
  });

  it('omits the name row when neither the profile nor the auth account has one', () => {
    setup();

    expect(screen.queryByText('Ada Lovelace')).toBeNull();
    // The account card should still just be email + role, nothing blank in between.
    expect(screen.getByText('member@example.com')).toBeInTheDocument();
  });

  it('omits the account card and sign out when nobody is signed in', () => {
    setup({ currentUser: null });

    expect(screen.queryByText('member@example.com')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    // The destinations themselves still render.
    expect(screen.getByText('Home')).toBeInTheDocument();
  });
});

describe('dialog behaviour', () => {
  it('moves focus to the close button on open', () => {
    setup();

    expect(document.activeElement).toBe(document.querySelector('.nav-sheet-close'));
  });

  it('locks the page behind it from scrolling, and releases on unmount', () => {
    const { unmount } = setup();

    expect(document.body.classList.contains('nav-sheet-open')).toBe(true);

    unmount();

    expect(document.body.classList.contains('nav-sheet-open')).toBe(false);
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.keyboard('{Escape}');

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the close button is pressed', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByRole('button', { name: 'Close menu' }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is tapped', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(document.querySelector('.nav-sheet-backdrop'));

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside the sheet, wrapping at both ends', async () => {
    const user = userEvent.setup();
    setup();

    const focusable = [...sheet().querySelectorAll('a[href], button:not([disabled])')];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    last.focus();
    await user.tab();
    expect(document.activeElement).toBe(first);

    await user.tab({ shift: true });
    expect(document.activeElement).toBe(last);
  });

  it('does not trap the backdrop in the tab order', () => {
    setup();

    const focusable = [...sheet().querySelectorAll('a[href], button:not([disabled])')];

    expect(focusable).not.toContain(document.querySelector('.nav-sheet-backdrop'));
    expect(document.querySelector('.nav-sheet-backdrop')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('acting on a row', () => {
  it('closes the sheet when a destination is chosen, so it does not cover the page it opened', async () => {
    const user = userEvent.setup();
    const { props } = setup();

    await user.click(screen.getByText('Member Directory'));

    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('closes before signing out, so focus is restored before the tree changes', async () => {
    const user = userEvent.setup();
    const calls = [];
    const { props } = setup({
      onClose: vi.fn(() => calls.push('close')),
      onSignOut: vi.fn(() => calls.push('signOut'))
    });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onSignOut).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['close', 'signOut']);
  });
});
