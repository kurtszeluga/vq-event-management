import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import RegisterPage from '../../src/pages/RegisterPage.jsx';
import { useEventRegistration } from '../../src/hooks/useEventRegistration.js';

// The payment panel is the thing under test by its absence, so it is mocked to
// something unmistakable rather than left to mount a real Square iframe.
vi.mock('../../src/components/RegistrationPaymentPanel.jsx', () => ({
  default: () => <div data-testid="payment-panel">card field</div>
}));

vi.mock('../../src/hooks/useEventRegistration.js', () => ({
  useEventRegistration: vi.fn()
}));

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => ({ currentUser: null, userProfile: null })
}));

vi.mock('../../src/lib/firebase.js', () => ({
  auth: {},
  db: {},
  storage: {}
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Mirrors openEvent() in tests/registration-eligibility.test.js: the window
// fields matter, since availability is derived from them rather than from a
// stored flag.
const DAY_MS = 24 * 60 * 60 * 1000;
const asLocalInput = (offsetMs) =>
  new Date(Date.now() + offsetMs).toISOString().slice(0, 16);

const PAID_EVENT = {
  cost: 25,
  eventType: 'Workshop',
  id: 'event-1',
  isPaid: true,
  registrationCloseAt: asLocalInput(7 * DAY_MS),
  registrationMode: 'now',
  registrationOpenAt: asLocalInput(-7 * DAY_MS),
  status: 'Published',
  title: 'Test Workshop'
};

function renderRegisterPage(event) {
  useEventRegistration.mockReturnValue({
    displayedTermsVersion: '1',
    event,
    eventError: '',
    loadingEvent: false,
    membershipSettings: { requireMembershipCheck: false }
  });

  return render(
    <MemoryRouter initialEntries={['/events/event-1/register']}>
      <Routes>
        <Route path="/events/:eventId/register" element={<RegisterPage />} />
        <Route path="/events/:eventId" element={<div>Event details</div>} />
        <Route path="/events" element={<div>Events list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('RegisterPage when registration is unavailable', () => {
  it('renders no form at all for a listing dated into the future', () => {
    renderRegisterPage({ ...PAID_EVENT, visibleFrom: asLocalInput(7 * DAY_MS) });

    expect(screen.getByRole('heading', { name: 'Registration Unavailable' })).toBeTruthy();

    // The three things that made it read as a broken page rather than a closed
    // one: a live card field, an email field, and a submit button.
    expect(screen.queryByTestId('payment-panel')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /submit registration/i })).toBeNull();

    // The way back is a button, not a link to a fixed route: an admin arriving
    // from the event list and a reader arriving from GoDaddy need different
    // destinations, so the destination is decided at click time.
    expect(screen.getByRole('button', { name: 'Back' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: /back to event/i })).toBeNull();
  });

  it('names the date the listing goes live instead of saying only "not available"', () => {
    renderRegisterPage({ ...PAID_EVENT, visibleFrom: asLocalInput(7 * DAY_MS) });

    expect(screen.getByText(/not listed on the website until/i)).toBeTruthy();
    expect(screen.getByText(/\d{2}\/\d{2}\/\d{4}/)).toBeTruthy();
  });

  it('still renders the form when the event is visible and open', () => {
    renderRegisterPage(PAID_EVENT);

    expect(screen.queryByRole('heading', { name: 'Registration Unavailable' })).toBeNull();
    expect(screen.getByText(/Register For Test Workshop/i)).toBeTruthy();
  });
});
