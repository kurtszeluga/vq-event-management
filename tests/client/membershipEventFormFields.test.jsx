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

  it('does not require a location to validate', () => {
    const errors = validateEventForm({
      ...DEFAULT_EVENT_FORM,
      description: 'Join or renew.',
      eventType: 'Membership',
      listingMode: 'now',
      registrationMode: 'now',
      title: 'Guild Membership'
    });

    expect(errors.locationPreset).toBeUndefined();
    expect(errors.location).toBeUndefined();
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
