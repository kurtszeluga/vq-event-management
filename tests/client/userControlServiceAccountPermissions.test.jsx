import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Asked for on 2026-11-21: "allow a service account to not have any admin
// controls enabled. Sometimes I want to be able to remove all controls for a
// while without messing up the service account attribute."
//
// The reason the second half matters: clearing the Service Account tag is what
// puts a role mailbox back in reach of the Annual Refresh, which marks every
// profile missing from the roster CSV Inactive - and an Inactive membership
// demotes an Admin and clears its permissions for good. So unticking the tag
// to get past "select at least one admin permission" would have been the
// expensive way to do a temporary thing.

const SERVICE_ACCOUNT = {
  id: 'svc-1',
  billingAddress: {},
  email: 'programs@villagequilters.com',
  firstName: 'Programs',
  lastName: 'Mailbox',
  membershipStatus: 'Active',
  name: 'Programs Mailbox',
  permissions: { manageEvents: true },
  phone: '',
  profileTags: ['serviceAccount'],
  role: 'Admin',
  status: 'Active',
  userId: 'svc-1'
};
const PERSON = {
  ...SERVICE_ACCOUNT,
  id: 'admin-2',
  email: 'ada@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  name: 'Ada Lovelace',
  profileTags: [],
  userId: 'admin-2'
};

let listedUser = SERVICE_ACCOUNT;

const updateUserProfile = vi.fn(() => Promise.resolve());

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));

vi.mock('../../src/services/userService.js', () => ({
  archiveUserProfile: vi.fn(),
  createUserByAdmin: vi.fn(),
  loadUserAuthStatus: vi.fn(() => Promise.resolve({})),
  reactivateUserProfile: vi.fn(),
  subscribeToUsers: (onNext) => {
    onNext({ docs: [{ id: listedUser.id, data: () => listedUser }] });
    return () => {};
  },
  updateUserPasswordByAdmin: vi.fn(),
  updateUserProfile: (...args) => updateUserProfile(...args)
}));

vi.mock('../../src/services/registrationService.js', () => ({
  subscribeToPayments: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));

const { default: UserControlPanel } = await import('../../src/components/admin/UserControlPanel.jsx');

afterEach(cleanup);
beforeEach(() => {
  updateUserProfile.mockClear();
});

function renderPanel() {
  return render(
    <UserControlPanel
      canManageAdminUsers
      currentUserProfile={{ id: 'super-1', role: 'Super User', status: 'Active', userId: 'super-1' }}
    />
  );
}

async function openEditForm(user) {
  await user.click(await screen.findByRole('button', { name: /edit/i }));
}

function permissionCheckbox(label) {
  return within(screen.getByText(label).closest('label')).getByRole('checkbox');
}

describe('a service account with every control cleared', () => {
  it('saves, and keeps its Admin role and its tag', async () => {
    listedUser = SERVICE_ACCOUNT;
    const user = userEvent.setup();
    renderPanel();
    await openEditForm(user);

    await user.click(permissionCheckbox('Manage Events And Activities'));
    expect(permissionCheckbox('Manage Events And Activities')).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /save user/i }));

    await waitFor(() => expect(updateUserProfile).toHaveBeenCalled());

    const [, payload] = updateUserProfile.mock.calls[0];

    expect(payload.role).toBe('Admin');
    expect(payload.profileTags).toEqual(['serviceAccount']);
    expect(Object.values(payload.permissions).filter(Boolean)).toEqual([]);
  });

  it('says on the form that the empty state is allowed', async () => {
    listedUser = SERVICE_ACCOUNT;
    const user = userEvent.setup();
    renderPanel();
    await openEditForm(user);

    expect(screen.getByText(/can be saved with none of these ticked/i)).toBeInTheDocument();
  });
});

describe('an ordinary Admin with every control cleared', () => {
  it('is still refused, which is the mistake the rule exists to catch', async () => {
    listedUser = PERSON;
    const user = userEvent.setup();
    renderPanel();
    await openEditForm(user);

    await user.click(permissionCheckbox('Manage Events And Activities'));
    await user.click(screen.getByRole('button', { name: /save user/i }));

    await waitFor(() => {
      expect(
        document.body.textContent
      ).toMatch(/Select at least one admin permission before saving an Admin profile\./);
    });
    expect(updateUserProfile).not.toHaveBeenCalled();
  });
});
