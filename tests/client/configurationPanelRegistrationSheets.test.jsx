import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Configuration > Google Sheets card. Worth a render test for one reason
// above the others: what a board member pastes into the folder field is the
// whole address out of Drive's URL bar, not the bare ID, and the save has to
// cope with that - a stored '1AbC...?usp=sharing' is a sync that fails on a
// folder that is plainly there, reported as a 404 nobody can explain.

const saveRegistrationSheetSettingsMock = vi.fn();
let storedSettings = null;

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
    saveRegistrationSheetSettings: (...args) => saveRegistrationSheetSettingsMock(...args),
    sendEmailInstructionsTest: vi.fn(),
    // Every subscription the panel makes has to be stubbed - see the note in
    // configurationPanelCsvImportFlow.test.jsx. An unstubbed one reaches the
    // real implementation and calls collection() on a null `db`.
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
    },
    subscribeToRegistrationSheetSettings: (onNext) => {
      onNext(storedSettings || actual.DEFAULT_REGISTRATION_SHEET_SETTINGS);
      return () => {};
    }
  };
});

const { buildRegistrationSheetSettingsPayload, normalizeDriveFolderId } = await import(
  '../../src/services/configurationService.js'
);
const { default: ConfigurationPanel } = await import('../../src/components/admin/ConfigurationPanel.jsx');

const ACTOR = { id: 'admin-1', name: 'Admin' };

beforeEach(() => {
  saveRegistrationSheetSettingsMock.mockReset();
  storedSettings = null;
});

afterEach(cleanup);

async function openCard(user) {
  render(<ConfigurationPanel currentUserProfile={ACTOR} />);
  await user.click(await screen.findByRole('button', { name: 'Google Sheets' }));
}

describe('Configuration > Google Sheets', () => {
  it('starts switched off with no folder set', async () => {
    const user = userEvent.setup();

    await openCard(user);

    expect(screen.getByLabelText(/Sync Registrations To Google Sheets/)).not.toBeChecked();
    expect(screen.getByPlaceholderText(/Paste the Drive folder link/)).toHaveValue('');
  });

  it('saves the switch and the folder together', async () => {
    const user = userEvent.setup();

    await openCard(user);
    await user.click(screen.getByLabelText(/Sync Registrations To Google Sheets/));
    await user.type(screen.getByPlaceholderText(/Paste the Drive folder link/), 'folder-abc');
    await user.click(screen.getByRole('button', { name: 'Save Google Sheet Settings' }));

    expect(saveRegistrationSheetSettingsMock).toHaveBeenCalledTimes(1);
    expect(saveRegistrationSheetSettingsMock.mock.calls[0][0]).toMatchObject({
      driveFolderId: 'folder-abc',
      enableRegistrationSheets: true
    });
  });

  it('shows what is already stored', async () => {
    const user = userEvent.setup();
    storedSettings = { driveFolderId: 'folder-xyz', enableRegistrationSheets: true };

    await openCard(user);

    expect(screen.getByLabelText(/Sync Registrations To Google Sheets/)).toBeChecked();
    expect(screen.getByPlaceholderText(/Paste the Drive folder link/)).toHaveValue('folder-xyz');
  });
});

describe('normalizeDriveFolderId', () => {
  it('takes the ID out of the address copied from Drive', () => {
    expect(normalizeDriveFolderId(
      'https://drive.google.com/drive/folders/1AbCdEf-GhIjKlMnOp?usp=sharing'
    )).toBe('1AbCdEf-GhIjKlMnOp');
  });

  it('handles the folder address with no query string', () => {
    expect(normalizeDriveFolderId('https://drive.google.com/drive/folders/1AbCdEf_GhI'))
      .toBe('1AbCdEf_GhI');
  });

  it('handles the ?id= form', () => {
    expect(normalizeDriveFolderId('https://drive.google.com/open?id=1AbCdEf-GhI'))
      .toBe('1AbCdEf-GhI');
  });

  it('passes a bare ID straight through, trimmed', () => {
    expect(normalizeDriveFolderId('  1AbCdEf-GhI  ')).toBe('1AbCdEf-GhI');
    expect(normalizeDriveFolderId('')).toBe('');
    expect(normalizeDriveFolderId(undefined)).toBe('');
  });

  it('normalizes on the way into the payload, not only in the field', () => {
    // The field keeps whatever was typed so it does not rewrite itself under
    // the cursor; the payload is where it has to be clean.
    expect(buildRegistrationSheetSettingsPayload({
      driveFolderId: 'https://drive.google.com/drive/folders/1AbC?usp=sharing',
      enableRegistrationSheets: true
    })).toEqual({
      driveFolderId: '1AbC',
      enableRegistrationSheets: true
    });
  });
});
