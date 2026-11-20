import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// These states were covered against RegistrationListPrintPage until the Google
// Sheet controls moved here. They were in the print page's toolbar because
// that page happened to load the event, but nobody opens a print view to reach
// a spreadsheet, so in practice they were hidden.
//
// The two-tier behaviour is the part worth keeping and is carried over intact:
// a prominent button only where pressing it does something, and a quiet
// "Update now" otherwise. The sync runs itself on every registration,
// cancellation and payment change, so a permanent Update button reads as an
// instruction - which is how coordinators came to believe they had to press it
// each time.

let sheetsEnabledResult = true;
// Whether anyone has been in the sheet since the sync last wrote it - the one
// thing only the server can answer, because only it can reach Drive.
let sheetEditedResult = false;
// REGISTRATIONS has two records, so a rowCount of 2 is "current".
let sheetLinkResult = {
  lastError: '',
  lastSyncedDate: new Date(),
  rowCount: 2,
  spreadsheetId: 'sheet-1',
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit'
};
const syncSheetMock = vi.fn(async () => ({ ok: true, rowCount: 2 }));

vi.mock('../../src/services/eventService.js', () => ({
  getEventRegistrationSheetState: () => Promise.resolve({
    editedSinceSync: sheetEditedResult,
    ok: true
  }),
  syncEventRegistrationSheet: (...args) => syncSheetMock(...args)
}));
vi.mock('../../src/services/eventRegistrationSheet.js', () => ({
  getEventRegistrationSheet: () => Promise.resolve(sheetLinkResult)
}));
// Required, not optional: unstubbed it reaches the real implementation and
// calls doc() on a null `db` without VITE_FIREBASE_* set.
vi.mock('../../src/services/configurationService.js', () => ({
  getRegistrationSheetSettings: () => Promise.resolve({
    driveFolderId: 'folder-1',
    enableRegistrationSheets: sheetsEnabledResult
  })
}));

const { default: EventGoogleSheetCard } = await import(
  '../../src/components/admin/EventGoogleSheetCard.jsx'
);

const REGISTRATIONS = [
  { id: 'reg-1', eventId: 'evt-1', name: 'Ada Lovelace', status: 'Registered' },
  { id: 'reg-2', eventId: 'evt-1', name: 'Grace Hopper', status: 'Waitlisted' }
];

function renderCard() {
  return render(
    <EventGoogleSheetCard
      eventId="evt-1"
      eventTitle="Quilt Basics"
      registrations={REGISTRATIONS}
    />
  );
}

afterEach(() => {
  cleanup();
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

describe('the Google Sheet card', () => {
  it('names the event it is about', async () => {
    renderCard();

    expect(await screen.findByText('Quilt Basics')).toBeTruthy();
  });

  it('offers no action, and says so, when the sheet is up to date', async () => {
    renderCard();

    expect(await screen.findByText('Open Google Sheet')).toBeTruthy();
    expect(screen.getByText(/Last synced just now with 2 registrations/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Update Sheet' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create Sheet' })).toBeNull();
    // The quiet refresh remains: a row deleted from the sheet by hand cannot
    // be detected from here, and this is the only way back from one.
    expect(screen.getByRole('button', { name: 'Update now' })).toBeTruthy();
    expect(screen.getByText(/if you have changed the sheet yourself/)).toBeTruthy();
  });

  it('resyncs from the quiet refresh when nothing looks wrong', async () => {
    renderCard();

    await userEvent.click(await screen.findByRole('button', { name: 'Update now' }));

    expect(syncSheetMock).toHaveBeenCalledWith('evt-1');
    expect(await screen.findByText('Sheet updated with 2 registrations.')).toBeTruthy();
  });

  it('says nothing at all when the feature is switched off', async () => {
    // Production has this off until deliberately enabled, and a control that
    // can only report "switched off" on every event is noise.
    sheetsEnabledResult = false;

    renderCard();

    await screen.findByText('Quilt Basics');
    expect(screen.queryByText('Open Google Sheet')).toBeNull();
    expect(screen.queryByRole('button', { name: /Sheet/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
  });

  it('offers Create Sheet for an event that has never had one', async () => {
    sheetLinkResult = { lastError: '', rowCount: 0, spreadsheetId: '', spreadsheetUrl: '' };

    renderCard();

    expect(await screen.findByRole('button', { name: 'Create Sheet' })).toBeTruthy();
    expect(screen.queryByText('Open Google Sheet')).toBeNull();
    expect(screen.getByText(/no Google Sheet yet/)).toBeTruthy();
  });

  it('offers Update Sheet, with the counts, when the sheet is behind', async () => {
    sheetLinkResult = { ...sheetLinkResult, rowCount: 1 };

    renderCard();

    expect(await screen.findByRole('button', { name: 'Update Sheet' })).toBeTruthy();
    expect(screen.getByText(/Last synced with 1 registration; there are now 2/)).toBeTruthy();
    // The prominent button is already offered, so no duplicate quiet one.
    expect(screen.queryByRole('button', { name: 'Update now' })).toBeNull();
  });

  it('offers Retry, and shows the reason, after a failed sync', async () => {
    sheetLinkResult = { ...sheetLinkResult, lastError: 'The caller does not have permission' };

    renderCard();

    expect(await screen.findByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.getByText(/The caller does not have permission/).className).toBe('form-error');
  });

  it('reports what the sync did', async () => {
    sheetLinkResult = { ...sheetLinkResult, rowCount: 1 };

    renderCard();

    await userEvent.click(await screen.findByRole('button', { name: 'Update Sheet' }));

    expect(syncSheetMock).toHaveBeenCalledWith('evt-1');
    expect(await screen.findByText('Sheet updated with 2 registrations.')).toBeTruthy();
  });

  it('says that hand-entered rows were kept', async () => {
    sheetLinkResult = { ...sheetLinkResult, rowCount: 1 };
    syncSheetMock.mockImplementation(async () => ({ manualRowCount: 1, ok: true, rowCount: 2 }));

    renderCard();

    await userEvent.click(await screen.findByRole('button', { name: 'Update Sheet' }));

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

    renderCard();

    await userEvent.click(await screen.findByRole('button', { name: 'Update Sheet' }));

    expect(
      await screen.findByText('Registration sheets are switched off in Configuration.')
    ).toBeTruthy();
  });

  it('warns when somebody has edited the sheet by hand', async () => {
    sheetEditedResult = true;

    renderCard();

    expect(await screen.findByRole('button', { name: 'Update Sheet' })).toBeTruthy();
  });

  it('clears the hand-edit warning once the sheet has been rebuilt', async () => {
    sheetEditedResult = true;

    renderCard();

    await userEvent.click(await screen.findByRole('button', { name: 'Update Sheet' }));
    await screen.findByText('Sheet updated with 2 registrations.');

    // Without resetting editedSinceSync the warning would persist until the
    // card was reopened, even though the rewrite has just put the sheet back.
    expect(screen.queryByRole('button', { name: 'Update Sheet' })).toBeNull();
  });
});
