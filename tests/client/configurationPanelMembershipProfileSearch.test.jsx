import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Membership Profiles list in Setup / System Config had status buttons and
// nothing else, so finding one person in an imported roster of hundreds meant
// scrolling. The search added here runs INSIDE the selected status, because the
// status buttons are exclusive and widening the search past them would make
// their counts lie. The consequence is the thing worth testing: a profile that
// matches but sits under another status must be reported, or the admin reads an
// empty table as "she is not in the system".

let storedMembers = [];

vi.mock('../../src/services/configurationService.js', async () => {
  const actual = await vi.importActual('../../src/services/configurationService.js');

  return {
    ...actual,
    archiveMembershipProfile: vi.fn(),
    deleteEventLocationDefault: vi.fn(),
    deleteEventTimeDefault: vi.fn(),
    importMembersFromCsvRows: vi.fn(),
    reactivateMembershipProfile: vi.fn(),
    saveCoordinatorAssignment: vi.fn(),
    saveDirectorySettings: vi.fn(),
    saveEmailInstructions: vi.fn(),
    saveEventLocationDefault: vi.fn(),
    saveEventTimeDefault: vi.fn(),
    saveMembershipProfile: vi.fn(),
    saveMembershipSettings: vi.fn(),
    savePaymentSettings: vi.fn(),
    saveRegistrationSheetSettings: vi.fn(),
    sendEmailInstructionsTest: vi.fn(),
    // Every subscription the panel makes has to be stubbed - an unstubbed one
    // reaches the real implementation and calls collection() on a null `db`.
    subscribeToBusinessTypeDefaults: (onNext) => {
      onNext({ docs: [] });
      return () => {};
    },
    subscribeToCoordinatorAssignments: (onNext) => {
      onNext({ docs: [] });
      return () => {};
    },
    subscribeToDirectorySettings: (onNext) => {
      onNext(actual.DEFAULT_DIRECTORY_SETTINGS);
      return () => {};
    },
    subscribeToEmailInstructions: (onNext) => {
      onNext(actual.DEFAULT_EMAIL_INSTRUCTIONS);
      return () => {};
    },
    subscribeToEventLocationDefaults: (onNext) => {
      onNext({ docs: [] });
      return () => {};
    },
    subscribeToEventTimeDefaults: (onNext) => {
      onNext({ docs: [] });
      return () => {};
    },
    subscribeToMembershipProfiles: (onNext) => {
      onNext({
        docs: storedMembers.map((member) => ({
          id: member.id,
          data: () => member
        }))
      });
      return () => {};
    },
    subscribeToMembershipSettings: (onNext) => {
      onNext(actual.DEFAULT_MEMBERSHIP_SETTINGS);
      return () => {};
    },
    subscribeToPaymentSettings: (onNext) => {
      onNext(actual.DEFAULT_PAYMENT_SETTINGS);
      return () => {};
    },
    subscribeToRegistrationSheetSettings: (onNext) => {
      onNext(actual.DEFAULT_REGISTRATION_SHEET_SETTINGS);
      return () => {};
    }
  };
});

const { default: ConfigurationPanel, filterMembershipProfilesBySearch } = await import(
  '../../src/components/admin/ConfigurationPanel.jsx'
);

const ACTOR = { id: 'admin-1', name: 'Admin' };

const MEMBERS = [
  {
    id: 'm1',
    firstName: 'Dorothy',
    lastName: 'Gale',
    email: 'dorothy@example.com',
    phone: '(555) 123-4567',
    membershipStatus: 'Active',
    status: 'Active',
    billingAddress: { city: 'Emerald City', state: 'KS' }
  },
  {
    id: 'm2',
    firstName: 'Henry',
    lastName: 'Gale',
    email: 'henry@example.com',
    phone: '555-987-6543',
    membershipStatus: 'Active',
    status: 'Active'
  },
  {
    id: 'm3',
    firstName: 'Glinda',
    lastName: 'Good',
    email: 'glinda@example.com',
    phone: '',
    membershipStatus: 'Inactive',
    status: 'Active'
  }
];

beforeEach(() => {
  storedMembers = MEMBERS;
});

afterEach(cleanup);

async function openMembershipProfiles(user) {
  render(<ConfigurationPanel currentUserProfile={ACTOR} />);
  await user.click(await screen.findByRole('button', { name: 'Membership Profiles' }));
}

function getTableText() {
  return document.querySelector('.configuration-mini-card table')?.textContent || '';
}

describe('Configuration > Membership Profiles search', () => {
  it('narrows the list to the typed name', async () => {
    const user = userEvent.setup();

    await openMembershipProfiles(user);
    expect(getTableText()).toContain('Dorothy');
    expect(getTableText()).toContain('Henry');

    await user.type(screen.getByLabelText('Search Membership Profiles'), 'dorothy');

    expect(getTableText()).toContain('Dorothy');
    expect(getTableText()).not.toContain('Henry');
  });

  it('says how many matches are filed under another status', async () => {
    const user = userEvent.setup();

    await openMembershipProfiles(user);
    await user.type(screen.getByLabelText('Search Membership Profiles'), 'glinda');

    // Glinda is Inactive and the list opens on Active, so the table is empty.
    // Without this line the admin has no way to tell that from "not a member".
    expect(screen.getByText(/1 match is filed under another status/)).toBeTruthy();
    expect(screen.getByText(/No active membership profiles match "glinda"/)).toBeTruthy();
  });

  it('clears the search and brings the whole status back', async () => {
    const user = userEvent.setup();

    await openMembershipProfiles(user);
    await user.type(screen.getByLabelText('Search Membership Profiles'), 'dorothy');
    await user.click(screen.getByRole('button', { name: 'Clear Search' }));

    expect(screen.getByLabelText('Search Membership Profiles')).toHaveValue('');
    expect(getTableText()).toContain('Henry');
  });
});

describe('filterMembershipProfilesBySearch', () => {
  it('returns everything for an empty term', () => {
    expect(filterMembershipProfilesBySearch(MEMBERS, '   ')).toHaveLength(3);
  });

  it('matches a phone number typed without the punctuation it is stored with', () => {
    const matched = filterMembershipProfilesBySearch(MEMBERS, '5551234');

    expect(matched.map((member) => member.id)).toEqual(['m1']);
  });

  it('matches email, town, and a last name held only in a combined name field', () => {
    expect(filterMembershipProfilesBySearch(MEMBERS, 'henry@example').map((m) => m.id))
      .toEqual(['m2']);
    expect(filterMembershipProfilesBySearch(MEMBERS, 'emerald').map((m) => m.id))
      .toEqual(['m1']);
    expect(
      filterMembershipProfilesBySearch(
        [{ id: 'm9', name: 'Toto Terrier', membershipStatus: 'Active' }],
        'terrier'
      ).map((m) => m.id)
    ).toEqual(['m9']);
  });

  it('does not let a single stray digit drag in every phone number', () => {
    expect(filterMembershipProfilesBySearch(MEMBERS, 'glinda5')).toHaveLength(0);
  });
});
