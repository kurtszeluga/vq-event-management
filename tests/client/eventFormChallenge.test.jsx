import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const { DEFAULT_EVENT_FORM } = await import('../../src/data/eventOptions.js');
const { buildEventPayload, default: EventForm, validateEventForm } = await import('../../src/components/admin/EventForm.jsx');

afterEach(cleanup);

async function renderFormAs(eventType) {
  const user = userEvent.setup();
  render(<EventForm onCancelEdit={vi.fn()} onSaved={vi.fn()} userProfile={{ id: 'admin-1' }} />);
  await user.selectOptions(screen.getByLabelText(/Event Type/), eventType);
}

// A challenge runs over a posting window instead of happening on a day, so it
// carries no date, time or presenter - only images and its visible-from/until
// pair. Everything else here is what any event needs to pass validation.
const challengeForm = {
  ...DEFAULT_EVENT_FORM,
  eventType: 'Challenges',
  title: 'Row By Row 2026',
  description: 'A year-long block challenge.',
  locationPreset: 'other',
  location: 'Guild Hall',
  registrationMode: 'none'
};

describe('challenge events collect no date, time or presenter', () => {
  it('validates with no date, where the same form as a Workshop would not', () => {
    expect(validateEventForm(challengeForm).date).toBeUndefined();

    const asWorkshop = { ...challengeForm, eventType: 'Workshop' };
    expect(validateEventForm(asWorkshop).date).toBe('Event date is required.');
  });

  it('writes date and presenter as empty strings even when the form still holds values', () => {
    const payload = buildEventPayload(
      { ...challengeForm, date: '2026-09-14', presenter: 'Judy Egan' },
      false,
      false
    );

    // Empty string rather than omitted: the public feed orders by date, and
    // Firestore drops documents that are missing the ordered field.
    expect(payload.date).toBe('');
    expect(payload).toHaveProperty('date');
    expect(payload.presenter).toBe('');
  });

  it('still carries images, which challenges previously could not have', () => {
    const payload = buildEventPayload(
      { ...challengeForm, imageUrls: ['block-1.jpg', '', 'block-2.jpg'] },
      false,
      false
    );

    expect(payload.imageUrls).toEqual(['block-1.jpg', 'block-2.jpg']);
  });

  it('leaves date and presenter alone for a normal event', () => {
    const payload = buildEventPayload(
      {
        ...challengeForm,
        eventType: 'Workshop',
        date: '2026-09-14',
        presenter: 'Judy Egan',
        timePreset: 'other',
        startTime: '13:30',
        endTime: '16:30'
      },
      false,
      false
    );

    expect(payload.date).toBe('2026-09-14');
    expect(payload.presenter).toBe('Judy Egan');
  });
});

describe('the challenge form hides the fields it does not use', () => {
  it('offers no date or presenter input, but does offer image slots', async () => {
    await renderFormAs('Challenges');

    expect(screen.queryByLabelText(/Date \*/)).toBeNull();
    expect(screen.queryByLabelText(/Presenter\/Instructor/)).toBeNull();
    // The photo slots are span.field-label, not <label>, so query by text.
    expect(screen.queryAllByText(/Photo 1 Of/).length).toBe(1);
  });

  it('still offers all three for a Workshop', async () => {
    await renderFormAs('Workshop');

    expect(screen.getByLabelText(/Date \*/)).toBeTruthy();
    expect(screen.getByLabelText(/Presenter\/Instructor/)).toBeTruthy();
    expect(screen.queryAllByText(/Photo 1 Of/).length).toBe(1);
  });
});
