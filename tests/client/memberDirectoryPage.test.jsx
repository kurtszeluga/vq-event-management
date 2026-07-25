import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const authState = {
  currentUser: { email: 'admin@example.com', uid: 'admin-1' },
  loading: false,
  userProfile: { membershipStatus: 'Active', status: 'Active' }
};

let directoryMembers = [];

vi.mock('../../src/context/useAuth.js', () => ({ useAuth: () => authState }));
vi.mock('react-router-dom', () => ({ Navigate: () => null }));
vi.mock('../../src/components/PageHeader.jsx', () => ({ default: () => null }));
vi.mock('../../src/services/configurationService.js', () => ({
  DEFAULT_DIRECTORY_SETTINGS: {
    directoryNote: '',
    enableMemberDirectory: true,
    showCityState: true,
    showEmail: true,
    showFullAddress: false,
    showPhone: true
  },
  subscribeToDirectorySettings: (onNext) => {
    onNext({
      directoryNote: '',
      enableMemberDirectory: true,
      showCityState: true,
      showEmail: true,
      showFullAddress: false,
      showPhone: true
    });
    return () => {};
  },
  subscribeToActiveMemberDirectoryProfiles: (onNext) => {
    onNext({ docs: directoryMembers.map((member) => ({ id: member.id, data: () => member })) });
    return () => {};
  }
}));

const { default: MemberDirectoryPage } = await import('../../src/pages/MemberDirectoryPage.jsx');

afterEach(cleanup);

function renderWithMember(overrides = {}) {
  directoryMembers = [{
    email: 'ada@example.com',
    firstName: 'Ada',
    id: 'member-1',
    lastName: 'Lovelace',
    phone: '3526538188',
    ...overrides
  }];
  return render(<MemberDirectoryPage />);
}

describe('directory contact values', () => {
  it('renders the email as a mailto link', () => {
    renderWithMember();

    const link = screen.getByRole('link', { name: 'ada@example.com' });
    expect(link).toHaveAttribute('href', 'mailto:ada@example.com');
  });

  it('renders the phone as a tel link using digits only, displaying the formatted number', () => {
    renderWithMember();

    const link = screen.getByRole('link', { name: '(352) 653-8188' });
    expect(link).toHaveAttribute('href', 'tel:3526538188');
  });

  it('shows "Not listed" with no link when email is missing', () => {
    renderWithMember({ email: '' });

    expect(screen.getByText('Not listed')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();
  });

  it('shows "Not listed" with no link when phone is missing', () => {
    renderWithMember({ phone: '' });

    const notListed = screen.getAllByText('Not listed');
    expect(notListed.length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /\(\d{3}\)/ })).toBeNull();
  });

  it('shows "Not listed" rather than a broken tel: link when the phone has no digits', () => {
    // Guards the fallback this test protects: formatPhoneNumber('---') returns
    // '', and the old inline expression already fell back to 'Not listed' for
    // that case - a href built from the raw value instead would have produced
    // a dead "tel:" link with no digits.
    renderWithMember({ phone: '---' });

    expect(screen.getAllByText('Not listed').length).toBeGreaterThan(0);
    expect(screen.queryByRole('link', { name: /\(\d{3}\)/ })).toBeNull();
  });
});
