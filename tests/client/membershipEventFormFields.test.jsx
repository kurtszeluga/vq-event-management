import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

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

const { default: EventForm, validateEventForm } = await import('../../src/components/admin/EventForm.jsx');
const { DEFAULT_EVENT_FORM } = await import('../../src/data/eventOptions.js');

afterEach(cleanup);

function renderForm(props = {}) {
  render(
    <EventForm
      onCancelEdit={vi.fn()}
      onSaved={vi.fn()}
      userProfile={{ id: 'admin-1' }}
      {...props}
    />
  );
}

describe('the Membership setup card', () => {
  it('locks the event type, so it cannot be changed by accident', () => {
    renderForm({ initialEventType: 'Membership' });

    const field = screen.getByLabelText(/Event Type/);

    // A disabled text input, not a dropdown. Changing the type on a live
    // signup would strip its dues schedule and leave a flat-priced event.
    expect(field.tagName).toBe('INPUT');
    expect(field).toBeDisabled();
    expect(field).toHaveValue('Membership');
    expect(screen.queryByRole('option', { name: 'Class (Half Day)' })).toBeNull();
  });

  it('locks it when editing an existing Membership event too', () => {
    renderForm({ editingEvent: { eventType: 'Membership', id: 'evt-1', title: 'Guild Membership' } });

    expect(screen.getByLabelText(/Event Type/).tagName).toBe('INPUT');
  });

  it('asks for no location', () => {
    renderForm({ initialEventType: 'Membership' });

    expect(screen.queryByLabelText(/Location/)).toBeNull();
  });

  it('says the listing dates open the signup link rather than list it', () => {
    renderForm({ initialEventType: 'Membership' });

    // "List On Website" would promise something that never happens for a type
    // excluded from every list.
    expect(screen.queryByLabelText(/List On Website/)).toBeNull();
    expect(screen.getByLabelText(/Open The Signup Link/)).toBeInTheDocument();
    expect(
      screen.getByText(/Membership never appears in a list on the website/)
    ).toBeInTheDocument();
  });

  // The form that the Membership module actually hands you: the defaults, plus
  // only the fields it puts on screen. If this does not validate, the save
  // fails with "Please fix the highlighted fields" and NOTHING is highlighted,
  // because every remaining error is on a field Membership does not render.
  //
  // Asserting the whole error object, not individual keys. Checking
  // errors.locationPreset alone is what let three other invisible
  // requirements - date, time preset and payment type - ship unnoticed.
  it('validates with exactly what the Membership card asks for, and nothing else', () => {
    const errors = validateEventForm({
      ...DEFAULT_EVENT_FORM,
      description: 'Join or renew your guild membership.',
      eventType: 'Membership',
      listingMode: 'now',
      // These two ARE on screen for Membership and are the admin's to fill -
      // the registration window is what opens and closes the signup link.
      registrationCloseAt: '2027-06-30T17:00',
      registrationMode: 'now',
      registrationOpenAt: '2026-11-16T09:00',
      title: 'Guild Membership'
    });

    expect(errors).toEqual({});
  });

  it('requires none of the fields it does not show', () => {
    const errors = validateEventForm({
      ...DEFAULT_EVENT_FORM,
      description: 'Join or renew.',
      eventType: 'Membership',
      listingMode: 'now',
      registrationMode: 'now',
      title: 'Guild Membership'
    });

    for (const hidden of ['location', 'locationPreset', 'date', 'timePreset', 'startTime', 'endTime', 'capacity', 'isPaid', 'cost']) {
      expect(errors[hidden]).toBeUndefined();
    }
  });
});

describe('every other event type', () => {
  it('keeps the free event type dropdown', () => {
    renderForm();

    const field = screen.getByLabelText(/Event Type/);

    expect(field.tagName).toBe('SELECT');
    expect(screen.getByRole('option', { name: 'Membership' })).toBeInTheDocument();
  });

  it('still requires a location', () => {
    const errors = validateEventForm({
      ...DEFAULT_EVENT_FORM,
      date: '2026-08-01',
      description: 'A class.',
      eventType: 'Class (Half Day)',
      listingMode: 'now',
      registrationMode: 'now',
      title: 'Binding Class'
    });

    expect(errors.locationPreset).toBe('Location is required.');
  });

  it('still says List On Website', () => {
    renderForm({ initialEventType: 'Challenges' });

    expect(screen.getByLabelText(/List On Website/)).toBeInTheDocument();
  });
});

describe('an unlisted signup has no admin registration route', () => {
  it('is named by UNLISTED_EVENT_TYPES, which both admin screens gate on', async () => {
    const { UNLISTED_EVENT_TYPES } = await import('../../src/data/eventOptions.js');

    // EventList and RegistrationPanel both hide their Register Myself /
    // Register A Member controls for these types. Admin-initiated
    // registration cannot take a card, so the only record it could have made
    // is a cash or cheque one against dues collected by card - a record that
    // does not match the money. The signup link is the only way in.
    expect(UNLISTED_EVENT_TYPES).toContain('Membership');
  });
});
