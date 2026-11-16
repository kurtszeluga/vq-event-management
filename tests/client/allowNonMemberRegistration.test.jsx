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

const { buildEventPayload, default: EventForm } = await import('../../src/components/admin/EventForm.jsx');
const { DEFAULT_EVENT_FORM } = await import('../../src/data/eventOptions.js');

afterEach(cleanup);

function nonMemberCheckbox() {
  return screen.queryByRole('checkbox', { name: /Allow Non-Members To Register/i });
}

function renderForm(props) {
  render(
    <EventForm onCancelEdit={vi.fn()} onSaved={vi.fn()} userProfile={{ id: 'admin-1' }} {...props} />
  );
}

describe('a Membership signup', () => {
  it('does not offer the choice at all', async () => {
    renderForm({ initialEventType: 'Membership' });

    // A membership signup is how someone BECOMES a member. Offering
    // "members only" on it is offering a way to make it unusable by exactly
    // the people it exists for, behind a red confirmation that makes the
    // correct answer look like the dangerous one.
    expect(nonMemberCheckbox()).toBeNull();
    expect(await screen.findByText(/Anyone can use this signup, member or not/i)).toBeInTheDocument();
  });

  it('saves as open to non-members whatever the stored form says', () => {
    const payload = buildEventPayload(
      {
        ...DEFAULT_EVENT_FORM,
        // The state the Membership module actually produces: the type is
        // locked, so the dropdown handler that would have set this true never
        // runs, and it sits at the DEFAULT_EVENT_FORM false.
        allowNonMemberRegistration: false,
        description: 'Join or renew.',
        eventType: 'Membership',
        listingMode: 'now',
        registrationMode: 'now',
        title: 'Guild Membership'
      },
      false,
      false
    );

    expect(payload.allowNonMemberRegistration).toBe(true);
  });
});

describe('every other event type keeps the choice', () => {
  it('stays checked once the confirmation is accepted, and reaches the payload', async () => {
    const user = userEvent.setup();

    renderForm({ initialEventType: 'Workshop' });

    const checkbox = nonMemberCheckbox();

    expect(checkbox).not.toBeChecked();

    // Ticking only opens a confirmation; the box must not read as on until
    // that is answered.
    await user.click(checkbox);
    expect(nonMemberCheckbox()).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /Allow Non-Members/i }));
    expect(nonMemberCheckbox()).toBeChecked();
  });

  it('stays unchecked when the confirmation is declined', async () => {
    const user = userEvent.setup();

    renderForm({ initialEventType: 'Workshop' });

    await user.click(nonMemberCheckbox());
    await user.click(screen.getByRole('button', { name: /Keep Members Only/i }));

    expect(nonMemberCheckbox()).not.toBeChecked();
  });

  it('opens checked when editing an event that already allows it', () => {
    renderForm({
      editingEvent: {
        allowNonMemberRegistration: true,
        eventType: 'Workshop',
        id: 'evt-1',
        title: 'Free Motion'
      }
    });

    expect(nonMemberCheckbox()).toBeChecked();
  });

  it('is still false by default, and stays false unless ticked', () => {
    const payload = buildEventPayload(
      {
        ...DEFAULT_EVENT_FORM,
        date: '2026-08-01',
        description: 'A workshop.',
        eventType: 'Workshop',
        listingMode: 'now',
        registrationMode: 'now',
        title: 'Free Motion'
      },
      false,
      false
    );

    expect(payload.allowNonMemberRegistration).toBe(false);
  });
});
