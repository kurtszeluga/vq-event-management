import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({
  Link: ({ children, to }) => <a href={to}>{children}</a>,
  Navigate: () => null
}));

// currentUser must keep a stable identity across renders - a fresh object
// literal here would make MyRegistrationsPage's `[currentUser]`-keyed effect
// see a "changed" dependency on every render (it calls setState synchronously
// from the mocked subscription), causing an infinite re-render loop.
const AUTH_STATE = { currentUser: { uid: 'user-1' }, loading: false };

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => AUTH_STATE
}));

vi.mock('../../src/services/eventService.js', () => ({
  subscribeToPublishedEvents: (onNext) => {
    onNext({ docs: [] });
    return () => {};
  }
}));

vi.mock('../../src/services/registrationService.js', () => ({
  subscribeToRegistrationPayments: (registrationId, userId, onNext) => {
    onNext({ docs: [] });
    return () => {};
  },
  subscribeToUserRegistrations: (userId, onNext) => {
    onNext({
      docs: [
        {
          id: 'reg-early-event-recent-signup',
          data: () => ({
            eventDate: '2026-06-01',
            eventId: 'evt-1',
            eventTitle: 'Earlier Event',
            registrationDate: '2026-07-20',
            status: 'Registered',
            userId: 'user-1'
          })
        },
        {
          id: 'reg-late-event-old-signup',
          data: () => ({
            eventDate: '2026-12-01',
            eventId: 'evt-2',
            eventTitle: 'Later Event',
            registrationDate: '2026-01-05',
            status: 'Registered',
            userId: 'user-1'
          })
        }
      ]
    });
    return () => {};
  }
}));

const { default: MyRegistrationsPage } = await import('../../src/pages/MyRegistrationsPage.jsx');

afterEach(cleanup);

describe('MyRegistrationsPage default sort', () => {
  it('orders by registration date (newest first), not by the event\'s own date', () => {
    render(<MyRegistrationsPage />);

    const rows = screen.getAllByText(/^(Earlier|Later) Event$/).map((cell) => cell.textContent);

    // "Earlier Event" was registered for most recently (2026-07-20), even
    // though "Later Event" itself happens further in the future - the list
    // must follow registration date, not event date.
    expect(rows).toEqual(['Earlier Event', 'Later Event']);
  });
});
