import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The dashboard pulls in Firebase-backed services and six heavy admin panels.
// None of them matter to the Manage/Edit nav, so they are stubbed out and the
// permission surface is driven entirely through the mocked useAuth below.
const authState = { hasPermission: () => false, isSuperUser: false, userProfile: {} };

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => authState
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ state: null })
}));

const archiveEventMock = vi.fn();
const reactivateEventMock = vi.fn();

vi.mock('../../src/services/eventService.js', () => ({
  archiveEvent: archiveEventMock,
  reactivateEvent: reactivateEventMock,
  subscribeToAdminEvents: (onSnapshot) => {
    onSnapshot({
      docs: [{
        id: 'evt-1',
        data: () => ({ title: 'Guild Retreat', status: 'Published' })
      }]
    });
    return () => {};
  }
}));

vi.mock('../../src/services/registrationService.js', () => ({
  loadPublicRegistrationCounts: () => Promise.resolve({}),
  subscribeToRegistrations: () => () => {},
  subscribeToSquareWebhookEvents: () => () => {}
}));

vi.mock('../../src/services/userService.js', () => ({
  subscribeToUsers: () => () => {}
}));

vi.mock('../../src/components/PageHeader.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/ConfigurationPanel.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/EventForm.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/EventList.jsx', () => ({
  default: ({ onDelete, title }) => (
    <div data-testid="event-list">
      <span>{title}</span>
      <button type="button" onClick={() => onDelete({ id: 'evt-1', title: 'Guild Retreat', status: 'Published' })}>
        Archive Guild Retreat
      </button>
    </div>
  )
}));
vi.mock('../../src/components/admin/PaymentReconciliationPanel.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/admin/RegistrationPanel.jsx', () => ({
  default: () => <div data-testid="registration-panel" />
}));
vi.mock('../../src/components/admin/UserControlPanel.jsx', () => ({ default: () => null }));

const { default: AdminDashboardPage } = await import('../../src/pages/AdminDashboardPage.jsx');

function signInAs({ permissions = [], isSuperUser = false } = {}) {
  authState.hasPermission = (permission) => permissions.includes(permission);
  authState.isSuperUser = isSuperUser;
}

function moduleNav() {
  return screen.getByRole('navigation', { name: 'Admin dashboard modules' });
}

function moduleToggle() {
  // Queried by class rather than by role/name: jsdom loads no stylesheet, so
  // the toggle and the full list are both present here regardless of viewport,
  // and its accessible name changes as the active module changes.
  return moduleNav().querySelector('.admin-nav-toggle');
}

beforeEach(() => {
  signInAs({ permissions: [], isSuperUser: false });
  archiveEventMock.mockReset();
  reactivateEventMock.mockReset();
});

// vitest.config.js does not set `globals: true`, so Testing Library never
// registers its automatic afterEach cleanup. Without this, each render leaks
// into the next test and the document-level lookups below find a stale nav.
afterEach(cleanup);

describe('Manage/Edit module list', () => {
  it('shows only the modules the signed-in admin has permission for', () => {
    signInAs({ permissions: ['viewRegistrations'] });
    render(<AdminDashboardPage />);

    const labels = within(moduleNav())
      .getAllByRole('button')
      .map((button) => button.textContent);

    expect(labels).toContain('Registrations');
    expect(labels).toContain('Payment Review');
    expect(labels.join(' ')).not.toContain('Events/Activities');
    expect(labels.join(' ')).not.toContain('User Controls');
    expect(labels.join(' ')).not.toContain('Setup / System Config');
  });

  it('gives a super user every module, in a stable order', () => {
    signInAs({ permissions: ['viewRegistrations', 'manageEvents', 'addUsers'], isSuperUser: true });
    render(<AdminDashboardPage />);

    const list = document.getElementById('admin-module-list');
    expect([...list.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Registrations',
      'Payment Review',
      'Events/Activities',
      'Challenges',
      'Business Listings',
      'For Sale',
      'Archive',
      'User Controls',
      'Setup / System Config'
    ]);
  });

  it('only shows Setup / System Config to a super user, not to an admin who can add users', () => {
    signInAs({ permissions: ['addUsers'], isSuperUser: false });
    render(<AdminDashboardPage />);

    const labels = [...document.getElementById('admin-module-list').querySelectorAll('button')]
      .map((button) => button.textContent);

    expect(labels).toContain('User Controls');
    expect(labels).not.toContain('Setup / System Config');
  });
});

describe('the collapsible mobile toggle', () => {
  it('starts collapsed, reporting no active section', () => {
    signInAs({ permissions: ['viewRegistrations', 'manageEvents'] });
    render(<AdminDashboardPage />);

    const toggle = moduleToggle();
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('Manage/Edit: Choose a section');
    // The toggle must point at the list it controls, or the expanded state is
    // not announced to assistive technology.
    expect(toggle.getAttribute('aria-controls')).toBe('admin-module-list');
    expect(document.getElementById('admin-module-list')).not.toBeNull();
  });

  it('expands and collapses on click', async () => {
    const user = userEvent.setup();
    signInAs({ permissions: ['viewRegistrations', 'manageEvents'] });
    render(<AdminDashboardPage />);

    await user.click(moduleToggle());
    expect(moduleToggle()).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('admin-module-list').className).toContain('is-open');

    await user.click(moduleToggle());
    expect(moduleToggle()).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('admin-module-list').className).not.toContain('is-open');
  });

  it('closes itself after a module is chosen, so the list does not cover the content it opened', async () => {
    const user = userEvent.setup();
    signInAs({ permissions: ['viewRegistrations', 'manageEvents'] });
    render(<AdminDashboardPage />);

    await user.click(moduleToggle());
    expect(document.getElementById('admin-module-list').className).toContain('is-open');

    await user.click(screen.getByRole('button', { name: 'Registrations' }));

    expect(document.getElementById('admin-module-list').className).not.toContain('is-open');
    expect(moduleToggle()).toHaveAttribute('aria-expanded', 'false');
  });

  it('names the active module so the collapsed row still says where you are', async () => {
    const user = userEvent.setup();
    signInAs({ permissions: ['viewRegistrations', 'manageEvents'] });
    render(<AdminDashboardPage />);

    await user.click(screen.getByRole('button', { name: 'Events/Activities' }));

    expect(moduleToggle()).toHaveTextContent('Manage/Edit: Events/Activities');
  });

  it('falls back to "Choose a section" while a module outside the row is open', async () => {
    const user = userEvent.setup();
    signInAs({ permissions: ['viewRegistrations', 'manageEvents'] });
    render(<AdminDashboardPage />);

    await user.click(screen.getByRole('button', { name: 'Events/Activities' }));
    expect(moduleToggle()).toHaveTextContent('Manage/Edit: Events/Activities');

    // 'event-details' (the EventForm) is a real activeModule value that has no
    // button in the row, so the label must not go blank.
    await user.click(screen.getByRole('button', { name: 'Create New Event/Activity' }));
    expect(moduleToggle()).toHaveTextContent('Manage/Edit: Choose a section');
  });
});

describe('selecting a module', () => {
  it('marks exactly one button active and opens that module', async () => {
    const user = userEvent.setup();
    signInAs({ permissions: ['viewRegistrations', 'manageEvents'] });
    render(<AdminDashboardPage />);

    await user.click(screen.getByRole('button', { name: 'Registrations' }));

    const active = [...document.getElementById('admin-module-list').querySelectorAll('button')]
      .filter((button) => button.getAttribute('aria-current') === 'page');

    expect(active.map((button) => button.textContent)).toEqual(['Registrations']);
    expect(screen.getByTestId('registration-panel')).toBeInTheDocument();
  });
});

describe('archive confirmation', () => {
  it('waits for confirmation before archiving an event', async () => {
    const user = userEvent.setup();
    signInAs({ permissions: ['manageEvents'] });
    render(<AdminDashboardPage />);

    await user.click(screen.getByRole('button', { name: 'Events/Activities' }));
    await user.click(screen.getByRole('button', { name: 'Archive Guild Retreat' }));

    expect(archiveEventMock).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Archive Event' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Archive Event' }));

    expect(archiveEventMock).toHaveBeenCalledWith('evt-1', {});
  });
});
