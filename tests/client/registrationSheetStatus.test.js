import { describe, expect, it } from 'vitest';
import {
  formatSyncAge,
  getRegistrationSheetStatus
} from '../../src/utils/registrationSheetStatus.js';

const NOW = Date.UTC(2026, 10, 11, 20, 0, 0);

function sheet(overrides = {}) {
  return {
    lastError: '',
    lastSyncedDate: new Date(NOW - 120 * 1000),
    rowCount: 2,
    spreadsheetId: 'sheet-1',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/sheet-1/edit',
    ...overrides
  };
}

const TWO_REGISTRATIONS = [{ registrationId: 'reg-1' }, { registrationId: 'reg-2' }];

describe('getRegistrationSheetStatus', () => {
  it('offers nothing when the feature is switched off', () => {
    // Nothing is rendered at all in this state. A project with the feature off
    // would otherwise show a control on every event that can only ever report
    // that the feature is off.
    const status = getRegistrationSheetStatus({
      enabled: false,
      now: NOW,
      registrations: TWO_REGISTRATIONS,
      sheet: sheet()
    });

    expect(status.state).toBe('disabled');
    expect(status.actionable).toBe(false);
    expect(status.message).toBeUndefined();
  });

  it('says how recently it synced when everything matches', () => {
    const status = getRegistrationSheetStatus({
      enabled: true,
      now: NOW,
      registrations: TWO_REGISTRATIONS,
      sheet: sheet()
    });

    expect(status.state).toBe('current');
    expect(status.actionable).toBe(false);
    expect(status.message).toBe('Updated 2 minutes ago');
    // No prominent button, but a quiet refresh stays available - see below.
    expect(status.canRefresh).toBe(true);
  });

  it('keeps a refresh available in every enabled state', () => {
    // A hand edit to the sheet - someone deleting a row - is invisible from
    // here, because every comparison is Firestore against Firestore and
    // rowCount is what the last sync WROTE. The quiet refresh is the only way
    // back from that, so it must not be gated on a detected problem.
    const states = [
      { registrations: TWO_REGISTRATIONS, sheet: sheet() },
      { registrations: TWO_REGISTRATIONS, sheet: sheet({ rowCount: 1 }) },
      { registrations: TWO_REGISTRATIONS, sheet: null },
      { registrations: TWO_REGISTRATIONS, sheet: sheet({ lastError: 'nope' }) }
    ];

    states.forEach((input) => {
      expect(getRegistrationSheetStatus({ enabled: true, now: NOW, ...input }).canRefresh).toBe(true);
    });

    // Except when the feature is off, where nothing is rendered at all.
    expect(getRegistrationSheetStatus({ enabled: false }).canRefresh).toBe(false);
  });

  it('cannot tell that a row was deleted from the sheet by hand', () => {
    // Documents the limit rather than pretending otherwise: the registrations
    // and the recorded rowCount still agree, so this reads as current even
    // though the sheet is now a row short. That is why canRefresh exists.
    const status = getRegistrationSheetStatus({
      enabled: true,
      now: NOW,
      registrations: TWO_REGISTRATIONS,
      sheet: sheet({ rowCount: 2 })
    });

    expect(status.state).toBe('current');
    expect(status.canRefresh).toBe(true);
  });

  it('asks to create a sheet when the event has never had one', () => {
    const status = getRegistrationSheetStatus({
      enabled: true,
      now: NOW,
      registrations: TWO_REGISTRATIONS,
      sheet: { lastError: '', rowCount: 0, spreadsheetId: '' }
    });

    expect(status.state).toBe('missing');
    expect(status.actionLabel).toBe('Create Sheet');
  });

  it('treats a missing link document the same as no sheet', () => {
    const status = getRegistrationSheetStatus({
      enabled: true,
      now: NOW,
      registrations: TWO_REGISTRATIONS,
      sheet: null
    });

    expect(status.state).toBe('missing');
  });

  it('spots a sheet that is behind, and says by how much', () => {
    // The row count is what catches a sync that silently did not run.
    const status = getRegistrationSheetStatus({
      enabled: true,
      now: NOW,
      registrations: TWO_REGISTRATIONS,
      sheet: sheet({ rowCount: 1 })
    });

    expect(status.state).toBe('stale');
    expect(status.actionLabel).toBe('Update Sheet');
    // Describes the last WRITE. It must not claim to know what the sheet
    // contains now, because nothing here has read the sheet.
    expect(status.message).toBe('Last synced with 1 registration; there are now 2.');
  });

  it('spots a sheet with MORE rows than there are registrations', () => {
    // Someone was deleted outright; the sheet still lists them.
    const status = getRegistrationSheetStatus({
      enabled: true,
      now: NOW,
      registrations: [{ registrationId: 'reg-1' }],
      sheet: sheet({ rowCount: 2 })
    });

    expect(status.state).toBe('stale');
  });

  it('reports a failure ahead of anything else', () => {
    // A failed CREATE leaves both lastError set and spreadsheetId empty. The
    // error is the more useful of the two things to say, and "Create Sheet"
    // would imply nothing had been tried.
    const status = getRegistrationSheetStatus({
      enabled: true,
      now: NOW,
      registrations: TWO_REGISTRATIONS,
      sheet: { lastError: 'File not found', rowCount: 0, spreadsheetId: '' }
    });

    expect(status.state).toBe('failed');
    expect(status.actionLabel).toBe('Retry');
    expect(status.message).toBe('File not found');
    expect(status.tone).toBe('error');
  });

  it('only marks a failure as an error, not advice to act', () => {
    // 'stale' and 'missing' are advisory and sit beside their own button;
    // painting them red would cry wolf on every event set up before the
    // feature was switched on.
    const stale = getRegistrationSheetStatus({
      enabled: true,
      now: NOW,
      registrations: TWO_REGISTRATIONS,
      sheet: sheet({ rowCount: 1 })
    });

    expect(stale.tone).toBe('notice');
  });

  it('counts cancelled registrations, because the sheet lists them', () => {
    // A cancelled registrant stays in the sheet with their status, so leaving
    // them out of the expected count would report a healthy sheet as stale.
    const status = getRegistrationSheetStatus({
      enabled: true,
      now: NOW,
      registrations: [
        { registrationId: 'reg-1', status: 'Registered' },
        { registrationId: 'reg-2', status: 'Cancelled' }
      ],
      sheet: sheet({ rowCount: 2 })
    });

    expect(status.state).toBe('current');
  });
});

describe('formatSyncAge', () => {
  it('reads as relative while that is still useful', () => {
    expect(formatSyncAge(new Date(NOW - 10 * 1000), NOW)).toBe('just now');
    expect(formatSyncAge(new Date(NOW - 60 * 1000), NOW)).toBe('1 minute ago');
    expect(formatSyncAge(new Date(NOW - 5 * 60 * 1000), NOW)).toBe('5 minutes ago');
    expect(formatSyncAge(new Date(NOW - 60 * 60 * 1000), NOW)).toBe('1 hour ago');
    expect(formatSyncAge(new Date(NOW - 5 * 60 * 60 * 1000), NOW)).toBe('5 hours ago');
  });

  it('falls back to a date once relative stops meaning anything', () => {
    expect(formatSyncAge(new Date(NOW - 3 * 24 * 60 * 60 * 1000), NOW)).toMatch(/^on /);
  });

  it('reads a Firestore timestamp as well as a Date', () => {
    expect(formatSyncAge({ toMillis: () => NOW - 120 * 1000 }, NOW)).toBe('2 minutes ago');
    expect(formatSyncAge({ seconds: (NOW - 120 * 1000) / 1000 }, NOW)).toBe('2 minutes ago');
  });

  it('says something harmless when there is no timestamp at all', () => {
    // An in-flight serverTimestamp() sentinel, or a document written before
    // lastSyncedDate was recorded.
    expect(formatSyncAge(null, NOW)).toBe('automatically');
    expect(formatSyncAge(undefined, NOW)).toBe('automatically');
  });

  it('does not report a clock-skewed future timestamp as negative', () => {
    expect(formatSyncAge(new Date(NOW + 30 * 1000), NOW)).toBe('just now');
  });
});

describe('when the settings read fails', () => {
  it('says so rather than looking like the feature is off', () => {
    // Rendering nothing for both would make a page that could not reach
    // Firestore indistinguishable from a project that has never switched this
    // on - which is exactly the confusion that cost an afternoon.
    const status = getRegistrationSheetStatus({
      enabled: null,
      now: NOW,
      registrations: TWO_REGISTRATIONS,
      sheet: sheet()
    });

    expect(status.state).toBe('unknown');
    expect(status.actionable).toBe(true);
    expect(status.tone).toBe('error');
    expect(status.message).toMatch(/could not be read/);
  });

  it('only an explicit null is unknown; omitting it fails closed', () => {
    // An omitted `enabled` takes the parameter default of false, which is the
    // right behaviour for a caller that has not looked - so it reads as off
    // and stays silent, rather than crying error at every page.
    expect(getRegistrationSheetStatus({}).state).toBe('disabled');
    expect(getRegistrationSheetStatus({ enabled: false }).state).toBe('disabled');
    expect(getRegistrationSheetStatus({ enabled: null }).state).toBe('unknown');
  });
});
