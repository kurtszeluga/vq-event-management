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
let sheetLinkResult = { lastError: '', rowCount: 0, spreadsheetId: '', spreadsheetUrl: '' };
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

const { default: RegistrationListPrintPage } = await import('../../src/pages/RegistrationListPrintPage.jsx');

afterEach(() => {
  cleanup();
  hasPermissionResult = true;
  getEventResult = EVENT;
  getRegistrationsResult = REGISTRATIONS;
  sheetLinkResult = { lastError: '', rowCount: 0, spreadsheetId: '', spreadsheetUrl: '' };
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

  it('offers the Google Sheet only once one exists', async () => {
    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    // No sheet yet - nothing to open, but the sync can still be asked for,
    // which is how an event that predates the feature gets one.
    expect(screen.queryByText('Open Google Sheet')).toBeNull();
    expect(screen.getByText('Update Sheet')).toBeTruthy();

    cleanup();
    sheetLinkResult = {
      lastError: '',
      rowCount: 2,
      spreadsheetId: 'sheet-1',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit'
    };
    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.getByText('Open Google Sheet').getAttribute('href'))
      .toBe('https://docs.google.com/spreadsheets/d/sheet-1/edit');
  });

  it('reports what the sync did', async () => {
    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');
    await userEvent.click(screen.getByText('Update Sheet'));

    expect(syncSheetMock).toHaveBeenCalledWith('evt-1');
    expect(await screen.findByText('Sheet updated with 2 registrations.')).toBeTruthy();
  });

  it('says that hand-entered rows were kept', async () => {
    // A coordinator who has typed walk-ins into the sheet needs to see that
    // the rewrite put them back, not just that it ran.
    syncSheetMock.mockImplementation(async () => ({ manualRowCount: 1, ok: true, rowCount: 2 }));

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');
    await userEvent.click(screen.getByText('Update Sheet'));

    expect(
      await screen.findByText('Sheet updated with 2 registrations, keeping 1 hand-entered row.')
    ).toBeTruthy();
  });

  it('says why nothing happened when the sync declines', async () => {
    // The server answers ok:false with a reason rather than erroring when the
    // feature is switched off, so the reason is what an admin must see -
    // otherwise the button looks broken.
    syncSheetMock.mockImplementation(async () => ({
      ok: false,
      reason: 'Registration sheets are switched off in Configuration.',
      skipped: true
    }));

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');
    await userEvent.click(screen.getByText('Update Sheet'));

    expect(
      await screen.findByText('Registration sheets are switched off in Configuration.')
    ).toBeTruthy();
  });

  it('surfaces a sync that failed earlier, before anyone presses anything', async () => {
    sheetLinkResult = {
      lastError: 'The caller does not have permission',
      rowCount: 0,
      spreadsheetId: '',
      spreadsheetUrl: ''
    };

    render(<RegistrationListPrintPage />);

    await screen.findByText('Quilt Basics');

    expect(screen.getByText(/The caller does not have permission/)).toBeTruthy();
  });

  it('refuses to load registrant data without the viewRegistrations permission', async () => {
    hasPermissionResult = false;

    render(<RegistrationListPrintPage />);

    expect(await screen.findByText('Permission required')).toBeTruthy();
    expect(screen.queryByText('Quilt Basics')).toBeNull();
  });
});
