import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));
vi.mock('../../src/services/eventService.js', () => ({
  createEvent: vi.fn(),
  updateEvent: vi.fn()
}));
vi.mock('../../src/services/storageService.js', () => ({
  deleteEventFile: vi.fn(),
  uploadEventImage: vi.fn(),
  uploadEventPdf: vi.fn()
}));
// Every subscription EventForm opens has to be stubbed. An unstubbed one falls
// through to the real implementation and calls collection(null), which throws
// here but happens to survive on a machine with .env.local set - the failure
// mode documented against this suite.
vi.mock('../../src/services/configurationService.js', () => ({
  subscribeToActiveBusinessTypeDefaults: (onNext) => {
    onNext([]);
    return () => {};
  },
  subscribeToActiveEventLocationDefaults: (onNext) => {
    onNext([]);
    return () => {};
  },
  subscribeToActiveEventTimeDefaults: (onNext) => {
    onNext([]);
    return () => {};
  },
  subscribeToPaymentSettings: (onNext) => {
    onNext({ defaultServiceFee: 1 });
    return () => {};
  }
}));

const { buildEventPayload } = await import('../../src/components/admin/EventForm.jsx');
const { DEFAULT_EVENT_FORM, NO_REGISTRATION_EVENT_TYPES } =
  await import('../../src/data/eventOptions.js');
const { getRegistrationWindowState } =
  await import('../../shared/registrationWindow.js');

function workshopForm(overrides = {}) {
  return {
    ...DEFAULT_EVENT_FORM,
    capacity: '12',
    date: '2026-09-14',
    endTime: '15:00',
    eventType: 'Workshop',
    startTime: '13:00',
    title: 'Open Sew',
    ...overrides
  };
}

describe('the None registration option', () => {
  it('is offered for a Workshop', () => {
    // A workshop is often an open session with nothing to sign up for.
    expect(NO_REGISTRATION_EVENT_TYPES).toContain('Workshop');
  });

  it('is not offered for a type that always takes registrations', () => {
    expect(NO_REGISTRATION_EVENT_TYPES).not.toContain('Class (Full Day)');
    expect(NO_REGISTRATION_EVENT_TYPES).not.toContain('Retreat');
  });
});

describe('a Workshop saved with registration set to None', () => {
  it('stores none and carries no registration window', () => {
    const payload = buildEventPayload(workshopForm({ registrationMode: 'none' }), false, false);

    expect(payload.registrationMode).toBe('none');
    expect(payload.registrationOpenAt).toBe('');
    expect(payload.registrationCloseAt).toBe('');
  });

  it('reads as closed to every registration check', () => {
    // 'none' is not one of REGISTRATION_WINDOW_MODES, so the shared gate
    // reports disabled and no Register control renders anywhere.
    const payload = buildEventPayload(workshopForm({ registrationMode: 'none' }), false, false);

    expect(getRegistrationWindowState(payload).state).toBe('disabled');
  });

  it('still takes registrations when a window is chosen instead', () => {
    const payload = buildEventPayload(
      workshopForm({
        registrationMode: 'now',
        registrationOpenAt: '2026-08-01T09:00',
        registrationCloseAt: '2026-09-13T17:00'
      }),
      false,
      false
    );

    expect(
      getRegistrationWindowState(payload, { now: Date.parse('2026-08-15T12:00:00Z') }).state
    ).toBe('open');
  });
});

// The option list itself, rendered. EventForm's convention is to test its
// exported pure functions and check interaction in the browser, but the admin
// form sits behind a sign-in, so the dropdown is read directly here instead.
describe('the Enable Event Registration dropdown', () => {
  async function optionsFor(eventType) {
    const { render, screen, cleanup } = await import('@testing-library/react');
    const { default: EventForm } = await import('../../src/components/admin/EventForm.jsx');

    cleanup();
    render(<EventForm editingEvent={{ ...DEFAULT_EVENT_FORM, eventType }} onCancel={() => {}} />);

    const select = screen.getByRole('combobox', { name: /enable event registration/i });

    return [...select.querySelectorAll('option')].map((option) => option.textContent.trim());
  }

  it('offers None for a Workshop', async () => {
    expect(await optionsFor('Workshop')).toEqual(['Select One', 'Now', 'In The Future', 'None']);
  });

  it('does not offer None for a full day class', async () => {
    expect(await optionsFor('Class (Full Day)')).toEqual(['Select One', 'Now', 'In The Future']);
  });
});
