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

const { default: EventForm } = await import('../../src/components/admin/EventForm.jsx');

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
