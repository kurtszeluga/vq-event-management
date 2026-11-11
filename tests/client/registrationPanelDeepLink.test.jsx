import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

// Arriving from an Events/Activities card's "Register A Member" shortcut names
// one specific event. The quarter and year filters here default to TODAY's, and
// groupedRegistrations only builds a group for an event that survives the
// filters - so a shortcut to an event from an earlier quarter found no group,
// left the drilled-in view empty, and opened the Register A Member panel with
// no event behind it. Submitting then threw "undefined is not an object
// (evaluating 'a.id')" out of `eventId: event.id`, with the filled-in form
// lost and nothing to tell the admin what went wrong.
//
// The event below is deliberately placed in a different quarter from today, so
// the default filter WOULD hide it.
const NOW = new Date();
const OTHER_QUARTER_MONTH = (((Math.floor(NOW.getMonth() / 3) + 2) % 4) * 3) + 1;
const OFF_QUARTER_DATE = `${NOW.getFullYear()}-${String(OTHER_QUARTER_MONTH + 1).padStart(2, '0')}-15`;

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>
}));

vi.mock('../../src/services/eventService.js', () => ({
  subscribeToAdminEvents: (onNext) => {
    onNext({
      docs: [{
        id: 'evt-off-quarter',
        data: () => ({
          capacity: 10,
          cost: 25,
          date: OFF_QUARTER_DATE,
          eventType: 'Workshop',
          isPaid: true,
          status: 'Published',
          title: 'Off Quarter Workshop'
        })
      }]
    });
    return () => {};
  },
  subscribeToPublishedEvents: () => () => {}
}));

vi.mock('../../src/services/registrationService.js', () => ({
  cancelRegistration: vi.fn(),
  createAdminRegistration: vi.fn(),
  subscribeToPayments: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  },
  subscribeToRegistrations: (onNext) => {
    onNext({
      docs: [{
        id: 'reg-1',
        data: () => ({
          amountPaid: 25,
          eventId: 'evt-off-quarter',
          name: 'Ada Lovelace',
          paymentStatus: 'Paid',
          registrationDate: `${OFF_QUARTER_DATE}T12:00:00.000Z`,
          status: 'Registered'
        })
      }]
    });
    return () => {};
  },
  subscribeToSquareWebhookEvents: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));

vi.mock('../../src/services/userService.js', () => ({
  subscribeToUsers: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));

// Required, not optional. An unstubbed subscription reaches the real
// implementation and calls doc() on a `db` that is null without VITE_FIREBASE_*
// set - so leaving this out passes on a machine with .env.local and fails in
// CI. Run `npm run test:client` with .env.local moved aside before trusting a
// green client suite.
vi.mock('../../src/services/configurationService.js', () => ({
  DEFAULT_PAYMENT_SETTINGS: { allowAppInitiatedRefunds: false },
  subscribeToPaymentSettings: (onNext) => {
    onNext({ allowAppInitiatedRefunds: false });
    return () => {};
  }
}));

const { default: RegistrationPanel } = await import('../../src/components/admin/RegistrationPanel.jsx');

afterEach(cleanup);

describe('a shortcut into one event ignores the date filters', () => {
  it('finds an event from a different quarter than today', async () => {
    render(
      <RegistrationPanel
        canManageEvents
        canRegisterOthers
        currentUserProfile={{}}
        initialEventId="evt-off-quarter"
      />
    );

    // The group was found, so the drilled-in view rendered its registrant.
    // Under the current-quarter default this event has no group at all and
    // this is "No matching events".
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
  });

  it('opens the Register A Member panel with an event behind it', async () => {
    render(
      <RegistrationPanel
        canManageEvents
        canRegisterOthers
        currentUserProfile={{}}
        initialEventId="evt-off-quarter"
        initialRegisterMemberOpen
      />
    );

    // Opening at all is the point: the panel is gated on the group having an
    // event, so if the filters still hid the event it would stay shut.
    expect(await screen.findByRole('heading', { name: 'Register A Member' })).toBeTruthy();
  });

  it('keeps the panel shut when the event genuinely cannot be found', async () => {
    // A registration whose event document was deleted outright has no event to
    // register against, and no cleared filter brings it back. Better shut than
    // open over nothing.
    render(
      <RegistrationPanel
        canManageEvents
        canRegisterOthers
        currentUserProfile={{}}
        initialEventId="evt-does-not-exist"
        initialRegisterMemberOpen
      />
    );

    // No group matches that id, so the panel falls back to its event list.
    await screen.findByText('Off Quarter Workshop');

    expect(screen.queryByRole('heading', { name: 'Register A Member' })).toBeNull();
  });
});
