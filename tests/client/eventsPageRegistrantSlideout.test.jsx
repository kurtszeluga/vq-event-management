import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The registrant list on the events list cards. It was first built on the
// event details page, which nothing in the app links to - so a member browsing
// /events saw nothing and correctly reported it missing.
//
// Nothing is fetched until a card is opened: browsing a page of twenty events
// must not open twenty listeners.

const authState = { userProfile: { membershipStatus: 'Active', status: 'Active' } };
let directorySettings = { showEventRegistrantNames: true };
const registrantSubscriptions = [];

vi.mock('../../src/context/useAuth.js', () => ({ useAuth: () => authState }));
vi.mock('../../src/lib/firebase.js', () => ({ auth: {}, db: {}, firebaseConfigured: true }));
vi.mock('../../src/services/eventService.js', () => ({
  subscribeToPublishedEvents: (onNext) => {
    onNext({
      docs: [{
        id: 'event-a',
        data: () => ({
          capacity: 10,
          date: '2026-09-14',
          description: '',
          endTime: '15:00',
          // A Programs type on purpose: the page opens on the Programs
          // filter, and a Workshop would be filtered out of the list.
          eventType: 'Class (Full Day)',
          imageUrls: [],
          registrationCloseAt: '2026-09-13T17:00',
          registrationMode: 'now',
          registrationOpenAt: '2026-08-01T09:00',
          startTime: '13:00',
          status: 'Published',
          title: 'Open Sew'
        })
      }]
    });
    return () => {};
  }
}));
vi.mock('../../src/services/registrationService.js', () => ({
  loadPublicRegistrationCounts: () => Promise.resolve({}),
  subscribeToRegistrations: () => () => {}
}));
vi.mock('../../src/services/configurationService.js', () => ({
  subscribeToDirectorySettings: (onNext) => {
    onNext(directorySettings);
    return () => {};
  },
  subscribeToCoordinatorAssignments: () => () => {}
}));
vi.mock('../../src/services/eventRegistrantNames.js', () => ({
  subscribeToEventRegistrantNames: (eventId, onNext) => {
    registrantSubscriptions.push(eventId);
    onNext(['Ada Lovelace', 'Mary Quilter']);
    return () => {};
  }
}));
vi.mock('../../src/components/PageHeader.jsx', () => ({ default: () => null }));
vi.mock('../../src/components/EventImageCarousel.jsx', () => ({ default: () => null }));

const { default: EventsPage } = await import('../../src/pages/EventsPage.jsx');

function renderPage() {
  return render(
    <MemoryRouter>
      <EventsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  registrantSubscriptions.length = 0;
  directorySettings = { showEventRegistrantNames: true };
  authState.userProfile = { membershipStatus: 'Active', status: 'Active' };
});

afterEach(cleanup);

describe('the registrant slideout on an event card', () => {
  it('offers the toggle but fetches nothing until it is clicked', async () => {
    renderPage();

    expect(await screen.findByRole('button', { name: /show who is registered/i })).toBeTruthy();
    expect(screen.queryByText('Ada Lovelace')).toBeNull();
    // The point of the slideout: browsing the list opens no listeners.
    expect(registrantSubscriptions).toEqual([]);
  });

  it('reveals the names on click', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /show who is registered/i }));

    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('Mary Quilter')).toBeTruthy();
    expect(registrantSubscriptions).toEqual(['event-a']);
  });

  it('closes again', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /show who is registered/i }));
    await screen.findByText('Ada Lovelace');
    await user.click(screen.getByRole('button', { name: /hide who is registered/i }));

    await waitFor(() => expect(screen.queryByText('Ada Lovelace')).toBeNull());
  });

  it('is absent when the board has the setting off', async () => {
    directorySettings = { showEventRegistrantNames: false };
    renderPage();

    await screen.findByText('Open Sew');
    expect(screen.queryByRole('button', { name: /who is registered/i })).toBeNull();
  });

  it('is absent for a lapsed membership', async () => {
    // Matches isActiveMember() in the rules - the read would be refused, so
    // offering the toggle would only produce an error.
    authState.userProfile = { membershipStatus: 'Inactive', status: 'Active' };
    renderPage();

    await screen.findByText('Open Sew');
    expect(screen.queryByRole('button', { name: /who is registered/i })).toBeNull();
  });

  it('is absent for a signed-out visitor', async () => {
    authState.userProfile = null;
    renderPage();

    await screen.findByText('Open Sew');
    expect(screen.queryByRole('button', { name: /who is registered/i })).toBeNull();
  });
});
