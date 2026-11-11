import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const navigateMock = vi.fn();

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
  useParams: () => ({ eventId: 'evt-1' }),
  useLocation: () => ({ state: null })
}));

let hasPermissionResult = true;

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => ({ hasPermission: () => hasPermissionResult })
}));

const EVENT = {
  id: 'evt-1',
  capacity: 4,
  cost: 25,
  date: '2026-08-01',
  eventType: 'Workshop',
  isPaid: true,
  location: 'Guild Hall',
  title: 'Quilt Basics'
};
const REGISTRATIONS = [
  {
    id: 'reg-1',
    amountPaid: 25,
    email: 'ada@example.com',
    eventId: 'evt-1',
    name: 'Ada Lovelace',
    paymentStatus: 'Paid',
    registrationDate: '2026-07-01',
    status: 'Registered'
  },
  {
    id: 'reg-2',
    amountPaid: 0,
    email: 'grace@example.com',
    eventId: 'evt-1',
    name: 'Grace Hopper',
    paymentStatus: 'Pending',
    registrationDate: '2026-07-02',
    status: 'Waitlisted'
  }
];

let getEventResult = EVENT;
let getRegistrationsResult = REGISTRATIONS;
let sheetsEnabledResult = true;
// REGISTRATIONS below has two records, so a rowCount of 2 is "current".
let sheetLinkResult = {
  lastError: '',
  lastSyncedDate: new Date(),
  rowCount: 2,
  spreadsheetId: 'sheet-1',
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit'
};
const syncSheetMock = vi.fn(async () => ({ ok: true, rowCount: 2 }));

vi.mock('../../src/services/eventService.js', () => ({
  getEvent: () => Promise.resolve(getEventResult),
  syncEventRegistrationSheet: (...args) => syncSheetMock(...args)
}));
vi.mock('../../src/services/registrationService.js', () => ({
  getRegistrationsForEvent: () => Promise.resolve(getRegistrationsResult)
}));
vi.mock('../../src/services/eventRegistrationSheet.js', () => ({
  getEventRegistrationSheet: () => Promise.resolve(sheetLinkResult)
}));
// Required, not optional: unstubbed it reaches the real implementation and
// calls doc() on a null `db` without VITE_FIREBASE_* set, which passes locally
// and fails in CI.
vi.mock('../../src/services/configurationService.js', () => ({
  getRegistrationSheetSettings: () => Promise.resolve({
    driveFolderId: 'folder-1',
    enableRegistrationSheets: sheetsEnabledResult
  })
}));

const { default: RegistrationListPrintPage } = await import('../../src/pages/RegistrationListPrintPage.jsx');

afterEach(() => {
  cleanup();
  hasPermissionResult = true;
  getEventResult = EVENT;
  getRegistrationsResult = REGISTRATIONS;
  sheetsEnabledResult = true;
  sheetLinkResult = {
    lastError: '',
    lastSyncedDate: new Date(),
    rowCount: 2,
    spreadsheetId: 'sheet-1',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit'
  };
  syncSheetMock.mockClear();
  syncSheetMock.mockImplementation(async () => ({ ok: true, rowCount: 2 }));
});

describe('RegistrationListPrintPage', () => {
  it('lists every registrant, including one who is waitlisted', async () => {
    render(<RegistrationListPrintPage />);

    expect(await screen.findByText('Quilt Basics')).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Grace Hopper')).toBeTruthy();
    expect(screen.getByText('Waitlisted')).toBeTruthy();
  });

  it('shows capacity, registered, waitlisted, and total paid stats', async () => {
    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.getByText('1/4 filled (3 open)')).toBeTruthy();
    expect(screen.getByText('1 Registered')).toBeTruthy();
    expect(screen.getByText('1 Waitlisted')).toBeTruthy();
    expect(screen.getByText('$25.00 Total Paid')).toBeTruthy();
  });

  it('never shows a Total Paid figure for a free event', async () => {
    getEventResult = { ...EVENT, isPaid: false };

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.queryByText(/Total Paid/)).toBeNull();
  });

  // The sync runs itself on every registration, cancellation and payment
  // change, so a permanent "Update Sheet" button read as an instruction -
  // coordinators believed they had to press it each time. The control is now
  // only rendered where pressing it does something.
  it('offers no action, and says so, when the sheet is up to date', async () => {
    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.getByText('Open Google Sheet')).toBeTruthy();
    expect(screen.getByText(/Updated just now/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update Sheet' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create Sheet' })).toBeNull();
    // A quiet refresh remains, because a row deleted from the sheet by hand
    // cannot be detected from here and this is the only way back from it.
    expect(screen.getByRole('button', { name: 'Update now' })).toBeTruthy();
  });

  it('resyncs from the quiet refresh when nothing looks wrong', async () => {
    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');
    await userEvent.click(screen.getByRole('button', { name: 'Update now' }));

    expect(syncSheetMock).toHaveBeenCalledWith('evt-1');
    expect(await screen.findByText('Sheet updated with 2 registrations.')).toBeTruthy();
  });

  it('says nothing at all about sheets when the feature is switched off', async () => {
    // Production will have this off until it is deliberately enabled, and a
    // control that can only report "switched off" on every event is noise.
    sheetsEnabledResult = false;

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.queryByText('Open Google Sheet')).toBeNull();
    expect(screen.queryByText(/Google Sheet:/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Sheet/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
  });

  it('offers Create Sheet for an event that has never had one', async () => {
    sheetLinkResult = { lastError: '', rowCount: 0, spreadsheetId: '', spreadsheetUrl: '' };

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.getByRole('button', { name: 'Create Sheet' })).toBeTruthy();
    expect(screen.queryByText('Open Google Sheet')).toBeNull();
  });

  it('offers Update Sheet, with the counts, when the sheet is behind', async () => {
    sheetLinkResult = { ...sheetLinkResult, rowCount: 1 };

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.getByRole('button', { name: 'Update Sheet' })).toBeTruthy();
    expect(screen.getByText(/Last synced with 1 registration; there are now 2/)).toBeTruthy();
    // The prominent button is already offered, so no duplicate quiet one.
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
  });

  it('offers Retry, and shows the reason, after a failed sync', async () => {
    sheetLinkResult = { ...sheetLinkResult, lastError: 'The caller does not have permission' };

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByText(/The caller does not have permission/)).toBeTruthy();
  });

  it('reports what the sync did', async () => {
    sheetLinkResult = { ...sheetLinkResult, rowCount: 1 };

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');
    await userEvent.click(screen.getByRole('button', { name: 'Update Sheet' }));

    expect(syncSheetMock).toHaveBeenCalledWith('evt-1');
    expect(await screen.findByText('Sheet updated with 2 registrations.')).toBeTruthy();
  });

  it('says that hand-entered rows were kept', async () => {
    sheetLinkResult = { ...sheetLinkResult, rowCount: 1 };
    syncSheetMock.mockImplementation(async () => ({ manualRowCount: 1, ok: true, rowCount: 2 }));

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');
    await userEvent.click(screen.getByRole('button', { name: 'Update Sheet' }));

    expect(
      await screen.findByText('Sheet updated with 2 registrations, keeping 1 hand-entered row.')
    ).toBeTruthy();
  });

  it('says why nothing happened when the sync declines', async () => {
    sheetLinkResult = { ...sheetLinkResult, rowCount: 1 };
    syncSheetMock.mockImplementation(async () => ({
      ok: false,
      reason: 'Registration sheets are switched off in Configuration.',
      skipped: true
    }));

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');
    await userEvent.click(screen.getByRole('button', { name: 'Update Sheet' }));

    expect(
      await screen.findByText('Registration sheets are switched off in Configuration.')
    ).toBeTruthy();
  });

  it('refuses to load registrant data without the viewRegistrations permission', async () => {
    hasPermissionResult = false;

    render(<RegistrationListPrintPage />);

    expect(await screen.findByText('Permission required')).toBeTruthy();
    expect(screen.queryByText('Quilt Basics')).toBeNull();
  });
});
