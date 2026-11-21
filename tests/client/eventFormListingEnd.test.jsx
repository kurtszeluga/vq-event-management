import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Asked for on 2026-11-21: choosing "List On Website: Now" should set the
// listing to start now and come down at 9 a.m. on the day of the event, since
// the guild takes registrations nearly up to the day.
//
// The half that needed the form rather than the helper: Remove Listing was
// only rendered for "In The Future", so a listing told to appear Now had no
// stated end at all and nothing to show a default in. A default nobody can
// see or change is a decision made for the admin.

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
// Every subscription EventForm opens has to be stubbed - an unstubbed one
// reaches the real implementation and passes only on a machine with
// .env.local in place.
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

const { default: EventForm, getInitialForm } = await import('../../src/components/admin/EventForm.jsx');

afterEach(cleanup);

const EVENT_DAY = '2099-12-11';

async function openFullDayClass() {
  const user = userEvent.setup();

  render(<EventForm onCancelEdit={vi.fn()} onSaved={vi.fn()} userProfile={{ id: 'admin-1' }} />);
  await user.selectOptions(screen.getByLabelText(/Event Type/), 'Class (Full Day)');

  return user;
}

// Anchored: the List On Website select's own help text now names Remove
// Listing too, so an unanchored match finds both.
function removeListingInput() {
  return screen.queryByLabelText(/^Remove Listing/);
}

describe('List On Website: Now', () => {
  it('shows Remove Listing, which used to appear only for a future listing', async () => {
    const user = await openFullDayClass();

    expect(removeListingInput()).toBeNull();

    await user.selectOptions(screen.getByLabelText(/List On Website/), 'now');

    expect(removeListingInput()).toBeInTheDocument();
  });

  it('fills it with 9 a.m. on the day of the event', async () => {
    const user = await openFullDayClass();

    await user.type(screen.getByLabelText(/Date \*/), EVENT_DAY);
    await user.selectOptions(screen.getByLabelText(/List On Website/), 'now');

    await waitFor(() => {
      expect(removeListingInput()).toHaveValue(`${EVENT_DAY}T09:00`);
    });
  });

  it('follows the event date when that is filled in afterwards', async () => {
    // The order an admin actually works in is not fixed: Now first and then
    // the date is at least as common as the other way round.
    const user = await openFullDayClass();

    await user.selectOptions(screen.getByLabelText(/List On Website/), 'now');
    await user.type(screen.getByLabelText(/Date \*/), EVENT_DAY);

    await waitFor(() => {
      expect(removeListingInput()).toHaveValue(`${EVENT_DAY}T09:00`);
    });
  });

  it('keeps a Remove Listing date the admin typed over it', async () => {
    const user = await openFullDayClass();

    await user.type(screen.getByLabelText(/Date \*/), EVENT_DAY);
    await user.selectOptions(screen.getByLabelText(/List On Website/), 'now');
    await user.clear(removeListingInput());
    await user.type(removeListingInput(), '2099-12-05T17:00');

    expect(removeListingInput()).toHaveValue('2099-12-05T17:00');
  });
});

describe('Enable Event Registration: Now', () => {
  // Reported 2026-11-21: "the same action should happen with the registration
  // now selection should set the registration end date to the event date."
  // The default was keyed on the TYPE - classes and workshops only - so a
  // Retreat or an Other event got an empty Registration Ends box.
  it.each(['Retreat', 'Other'])('fills Registration Ends for a %s', async (eventType) => {
    const user = userEvent.setup();

    render(<EventForm onCancelEdit={vi.fn()} onSaved={vi.fn()} userProfile={{ id: 'admin-1' }} />);
    await user.selectOptions(screen.getByLabelText(/Event Type/), eventType);
    await user.type(screen.queryAllByLabelText(/Date \*/)[0], EVENT_DAY);
    await user.selectOptions(screen.getByLabelText(/List On Website/), 'now');
    await user.selectOptions(screen.getByLabelText(/Enable Event Registration/), 'now');

    await waitFor(() => {
      expect(screen.queryAllByLabelText(/Registration Ends/)[0]).toHaveValue(`${EVENT_DAY}T09:00`);
    });
  });
});

// The half that only shows up on an EXISTING event. Until Remove Listing was
// rendered for "list now" it was neither shown nor required in that mode, so
// events saved that way carry no visibleUntil at all - and the defaults fire
// when the admin PICKS Now, which an event already set to Now never is. The
// box opened blank and stayed blank, which is what "it doesn't default" meant.
describe('opening an event that was saved before these defaults existed', () => {
  const STORED = {
    capacity: 20,
    cost: 0,
    date: EVENT_DAY,
    endTime: '16:30',
    eventType: 'Class (Full Day)',
    id: 'event-1',
    listingMode: 'now',
    registrationCloseAt: '',
    registrationMode: 'now',
    registrationOpenAt: `${EVENT_DAY}T08:00`,
    startTime: '09:30',
    title: 'Older Class',
    visibleFrom: `${EVENT_DAY}T08:00`,
    visibleUntil: ''
  };

  it('fills the missing listing end with the 9 a.m. default', () => {
    expect(getInitialForm(STORED).visibleUntil).toBe(`${EVENT_DAY}T09:00`);
  });

  it('fills a missing registration end from the event start', () => {
    expect(getInitialForm(STORED).registrationCloseAt).toBe(`${EVENT_DAY}T09:30`);
  });

  it('leaves dates the event already carries alone', () => {
    const edited = getInitialForm({
      ...STORED,
      registrationCloseAt: `${EVENT_DAY}T07:00`,
      visibleUntil: '2099-12-01T17:00'
    });

    expect(edited.visibleUntil).toBe('2099-12-01T17:00');
    expect(edited.registrationCloseAt).toBe(`${EVENT_DAY}T07:00`);
  });

  it('invents nothing for a type with no date', () => {
    // A Challenge runs over a posting window and collects no event date, so
    // there is nothing to count back from - and its Remove Listing is a
    // date-only field with its own midnight meaning.
    const challenge = getInitialForm({
      ...STORED,
      date: '',
      eventType: 'Challenges',
      startTime: '00:00'
    });

    expect(challenge.visibleUntil).toBe('');
    expect(challenge.registrationCloseAt).toBe('');
  });

  it('shows the seeded date on the form, not just in the model', async () => {
    render(
      <EventForm
        editingEvent={STORED}
        onCancelEdit={vi.fn()}
        onSaved={vi.fn()}
        userProfile={{ id: 'admin-1' }}
      />
    );

    await waitFor(() => {
      expect(removeListingInput()).toHaveValue(`${EVENT_DAY}T09:00`);
    });
  });
});
