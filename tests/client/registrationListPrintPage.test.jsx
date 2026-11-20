import { cleanup, render, screen } from '@testing-library/react';
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
// Whether anyone has been in the sheet since the sync last wrote it - the one
// thing only the server can answer, because only it can reach Drive.
let sheetEditedResult = false;
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
  getEventRegistrationSheetState: () => Promise.resolve({
    editedSinceSync: sheetEditedResult,
    ok: true
  }),
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
  sheetEditedResult = false;
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
  // Everything this suite used to assert about Google Sheets now lives in
  // tests/client/eventGoogleSheetCard.test.jsx, along with the controls. They
  // were in this page's toolbar because it happened to load the event, but
  // nobody opens a print view to reach a spreadsheet.
  //
  // The sheet prompt is gone rather than moved: it interrupted whoever opened
  // this page when the sheet was behind, and with the controls on a card of
  // their own the status is simply visible wherever the sheet is reached.
  it('refuses to load registrant data without the viewRegistrations permission', async () => {
    hasPermissionResult = false;

    render(<RegistrationListPrintPage />);

    expect(await screen.findByText('Permission required')).toBeTruthy();
    expect(screen.queryByText('Quilt Basics')).toBeNull();
  });
});
