import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Rows with data problems (missing name, bad email/phone) are no longer
// excluded from import and shown only in a preview that vanishes once the
// admin confirms - that left no durable way to find and fix them. They now
// import anyway with a Pending membership status and a review note (see
// configurationServiceCsvPendingReview.test.js for that logic), landing in
// the existing, durable Membership Profiles list instead of a side panel
// that only lived in this component's in-memory state.

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

describe('CSV import: rows with issues import as Pending instead of being excluded', () => {
  it('shows a review warning (not a block) in the preview and still offers to import every row', async () => {
    const user = userEvent.setup();
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

    expect(await screen.findByText(/3 rows found, 3 ready to import, 2 will need review/)).toBeTruthy();
    expect(screen.getByText(/Row 2 \(Sam\): Missing last name/)).toBeTruthy();
    expect(screen.getByText(/Row 3 \(Judy Egan\): Invalid email format/)).toBeTruthy();
    // All 3 - nothing is excluded from the count anymore.
    expect(screen.getByRole('button', { name: 'Import 3 Profiles' })).not.toBeDisabled();
  });

  it('reports how many rows were set to Pending for review after import completes', async () => {
    const user = userEvent.setup();
    importMembersFromCsvRowsMock.mockResolvedValue({
      createdCount: 3,
      importedCount: 3,
      pendingReviewCount: 2,
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

    await user.click(screen.getByRole('button', { name: 'Import 3 Profiles' }));

    await waitFor(() => {
      expect(importMembersFromCsvRowsMock).toHaveBeenCalledTimes(1);
    });
    expect(importMembersFromCsvRowsMock.mock.calls[0][0]).toHaveLength(3);

    expect(
      await screen.findByText(/2 row\(s\) had missing or invalid data and were set to Pending/)
    ).toBeTruthy();
    // The old side list is gone - Pending review now lives in the profile
    // list itself (via the existing Pending status filter), not a widget
    // that only survives until the next render.
    expect(screen.queryByText('Rows That Need Fixing')).toBeNull();
  });
});
