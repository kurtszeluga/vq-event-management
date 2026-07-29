import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The bug this guards against: after a CSV import, rows that failed
// validation (missing name, invalid email, etc.) used to vanish along with
// the rest of the preview - the admin had no way to find and fix them.
// This drives the real component through choose -> review -> import and
// checks the flagged rows persist afterward with working Edit/Dismiss
// actions, instead of mocking ConfigurationPanel away like the dashboard
// nav tests do.

const importMembersFromCsvRowsMock = vi.fn();

vi.mock('../../src/services/configurationService.js', async () => {
  const actual = await vi.importActual('../../src/services/configurationService.js');

  return {
    ...actual,
    archiveMembershipProfile: vi.fn(),
    deleteEventLocationDefault: vi.fn(),
    deleteEventTimeDefault: vi.fn(),
    importMembersFromCsvRows: (...args) => importMembersFromCsvRowsMock(...args),
    reactivateMembershipProfile: vi.fn(),
    saveCoordinatorAssignment: vi.fn(),
    saveDirectorySettings: vi.fn(),
    saveEmailInstructions: vi.fn(),
    saveEventLocationDefault: vi.fn(),
    saveEventTimeDefault: vi.fn(),
    saveMembershipProfile: vi.fn(),
    saveMembershipSettings: vi.fn(),
    savePaymentSettings: vi.fn(),
    sendEmailInstructionsTest: vi.fn(),
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
      onNext({ docs: [] });
      return () => {};
    },
    subscribeToMembershipSettings: (onNext) => {
      onNext(actual.DEFAULT_MEMBERSHIP_SETTINGS);
      return () => {};
    },
    subscribeToPaymentSettings: (onNext) => {
      onNext(actual.DEFAULT_PAYMENT_SETTINGS);
      return () => {};
    }
  };
});

const { default: ConfigurationPanel } = await import('../../src/components/admin/ConfigurationPanel.jsx');

afterEach(cleanup);

function makeCsvFile(rows) {
  const csv = ['Last Name,First Name,Email,Phone', ...rows].join('\n');
  return new File([csv], 'roster.csv', { type: 'text/csv' });
}

async function uploadCsv(user, file) {
  await user.selectOptions(screen.getByLabelText('Import Mode'), 'Add/Update Only');
  const fileInput = document.querySelector('input[type="file"]');
  await user.upload(fileInput, file);
}

describe('CSV import: rows needing fixing persist after import', () => {
  it('keeps invalid rows visible with Edit/Dismiss actions once the import completes', async () => {
    const user = userEvent.setup();
    importMembersFromCsvRowsMock.mockResolvedValue({
      createdCount: 1,
      importedCount: 1,
      reviewCount: 0,
      reviewRows: [],
      skippedSuperUserCount: 0,
      updatedCount: 0
    });

    render(<ConfigurationPanel currentUserProfile={{ id: 'admin-1', name: 'Admin' }} />);

    await user.click(await screen.findByRole('button', { name: 'Membership Profiles' }));

    await uploadCsv(
      user,
      makeCsvFile([
        'Adams,Nancy,adamsn952@gmail.com,919 349-2725',
        ',Sam,sam.no-lastname@example.com,555-201-9813',
        'Egan,Judy,not-an-email,555-201-9815'
      ])
    );

    expect(await screen.findByText(/2 rows need fixing/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Import 1 Profile' }));

    await waitFor(() => {
      expect(importMembersFromCsvRowsMock).toHaveBeenCalledTimes(1);
    });

    // The old bug: this whole section disappeared with the rest of the
    // preview once setCsvPreview(null) ran after a successful import.
    expect(await screen.findByText('Rows That Need Fixing')).toBeTruthy();
    expect(screen.getByText(/Missing last name/)).toBeTruthy();
    expect(screen.getByText(/Invalid email format/)).toBeTruthy();
    expect(screen.queryByText(/rows need fixing before they can be imported/)).toBeNull();

    const samRow = screen.getByText(/Row 2: Sam/).closest('.configuration-review-item');
    await user.click(within(samRow).getByRole('button', { name: 'Edit' }));

    expect(await screen.findByDisplayValue('Sam')).toBeTruthy();
    expect(screen.getByDisplayValue('sam.no-lastname@example.com')).toBeTruthy();

    const judyRow = screen.getByText(/Row 3: Judy Egan/).closest('.configuration-review-item');
    await user.click(within(judyRow).getByRole('button', { name: 'Dismiss' }));

    expect(screen.queryByText(/Row 3: Judy Egan/)).toBeNull();
    expect(screen.getByText(/Row 2: Sam/)).toBeTruthy();
  });
});
