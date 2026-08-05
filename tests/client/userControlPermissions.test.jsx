import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Drives the real UserControlPanel as a Super User editing somebody else's
// profile, which is the path a Super User uses to grant admin permissions.
// Written because "I can't change the profile permissions" kept being reported
// against a rule set that reads as though it should allow it.

const MEMBER = {
  id: 'user-2',
  billingAddress: { city: 'Loudon', country: 'United States', postalCode: '37774', state: 'TN', street: '12 Awohili Drive' },
  email: 'member@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  membershipStatus: 'Active',
  name: 'Ada Lovelace',
  permissions: {},
  phone: '(865) 555-1234',
  role: 'General User',
  status: 'Active',
  userId: 'user-2'
};

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));

vi.mock('../../src/services/userService.js', () => ({
  archiveUserProfile: vi.fn(),
  createUserByAdmin: vi.fn(),
  // The panel loads sign-in history for the listed members; nothing here
  // depends on it, so it resolves empty and every row shows a dash.
  loadUserAuthStatus: vi.fn(() => Promise.resolve({})),
  reactivateUserProfile: vi.fn(),
  subscribeToUsers: (onNext) => {
    onNext({ docs: [{ id: MEMBER.id, data: () => MEMBER }] });
    return () => {};
  },
  updateUserPasswordByAdmin: vi.fn(),
  updateUserProfile: vi.fn()
}));

vi.mock('../../src/services/registrationService.js', () => ({
  subscribeToPayments: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));

const { default: UserControlPanel } = await import('../../src/components/admin/UserControlPanel.jsx');

afterEach(cleanup);

function renderPanel() {
  return render(
    <UserControlPanel
      canManageAdminUsers
      currentUserProfile={{ id: 'super-1', role: 'Super User', status: 'Active', userId: 'super-1' }}
    />
  );
}

async function openEditForm(user) {
  const editButton = await screen.findByRole('button', { name: /edit/i });
  await user.click(editButton);
}

function permissionCheckbox(label) {
  return within(screen.getByText(label).closest('label')).getByRole('checkbox');
}

describe('a Super User granting admin permissions to a member', () => {
  it('leaves the checkboxes locked while the member is still a General User', async () => {
    const user = userEvent.setup();
    renderPanel();
    await openEditForm(user);

    expect(permissionCheckbox('Manage Events And Activities')).toBeDisabled();
  });

  it('unlocks them as soon as the role is set to Admin', async () => {
    const user = userEvent.setup();
    renderPanel();
    await openEditForm(user);

    await user.selectOptions(screen.getByRole('combobox', { name: /role/i }), 'Admin');

    expect(permissionCheckbox('Manage Events And Activities')).toBeEnabled();
  });

  it('lets the permission actually be ticked once unlocked', async () => {
    const user = userEvent.setup();
    renderPanel();
    await openEditForm(user);

    await user.selectOptions(screen.getByRole('combobox', { name: /role/i }), 'Admin');
    await user.click(permissionCheckbox('Manage Events And Activities'));

    expect(permissionCheckbox('Manage Events And Activities')).toBeChecked();
  });

  it('offers Admin as a selectable option for an Active member', async () => {
    const user = userEvent.setup();
    renderPanel();
    await openEditForm(user);

    const adminOption = within(screen.getByRole('combobox', { name: /role/i }))
      .getByRole('option', { name: 'Admin' });

    expect(adminOption).not.toBeDisabled();
  });
});
