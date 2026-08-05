import { describe, expect, it, vi } from 'vitest';

// The directory settings payload used to be a hand-listed set of fields, and
// adding a setting to the defaults and the form was not enough - the writer had
// to be edited too. Miss that and the failure is quiet in the worst way: the
// checkbox moves, the save reports success, and the subscription re-emits the
// stored document without the field so the box springs back off. That is
// exactly what happened to showEventRegistrantNames.

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {} }));

const { DEFAULT_DIRECTORY_SETTINGS, buildDirectorySettingsPayload } =
  await import('../../src/services/configurationService.js');

describe('the directory settings payload', () => {
  it('writes every setting the defaults declare', () => {
    // The guard that matters. A setting added to the defaults and the form is
    // now written by construction, so this cannot regress silently again.
    const payload = buildDirectorySettingsPayload(DEFAULT_DIRECTORY_SETTINGS);

    expect(Object.keys(payload).sort()).toEqual(Object.keys(DEFAULT_DIRECTORY_SETTINGS).sort());
  });

  it('carries the registrant-names setting through in both positions', () => {
    expect(buildDirectorySettingsPayload({ showEventRegistrantNames: true }).showEventRegistrantNames)
      .toBe(true);
    expect(buildDirectorySettingsPayload({ showEventRegistrantNames: false }).showEventRegistrantNames)
      .toBe(false);
  });

  it('coerces a missing boolean to false rather than undefined', () => {
    // Firestore rejects undefined, and the rules require a bool.
    const payload = buildDirectorySettingsPayload({});

    Object.entries(DEFAULT_DIRECTORY_SETTINGS).forEach(([key, value]) => {
      expect(typeof payload[key]).toBe(typeof value);
    });
  });

  it('trims the free-text note', () => {
    expect(buildDirectorySettingsPayload({ directoryNote: '  hello  ' }).directoryNote)
      .toBe('hello');
  });

  it('ignores anything not declared in the defaults', () => {
    // The rules pin the document with hasOnly(), so a stray key would be
    // refused outright and take the whole save with it.
    const payload = buildDirectorySettingsPayload({ somethingElse: true });

    expect('somethingElse' in payload).toBe(false);
  });
});
