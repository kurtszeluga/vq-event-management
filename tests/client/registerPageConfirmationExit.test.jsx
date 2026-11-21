import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Reported on 2026-11-21 after a live card payment made from a link on the
// guild's GoDaddy site: the confirmation page carried the app's own nav row
// (Home, Login, Business Listings, For Sale) and a "Return To List" button
// that opened the app's events page. The guild is rolling this system out in
// chunks, so neither was something the member was meant to be offered.
//
// What this pins: no nav anywhere on the confirmation, the button reads
// "Return", and it goes back to the guild page when we were told which one -
// otherwise to a terminal card, since window.close() cannot close a tab the
// app did not open and the feed's Register link is a plain target="_blank".

const createRegistration = vi.fn(() => Promise.resolve({
  paymentStatus: 'Paid',
  registrationId: 'reg-1',
  status: 'Registered'
}));

vi.mock('../../src/components/RegistrationPaymentPanel.jsx', () => ({
  default: () => <div data-testid="payment-panel">card field</div>
}));

vi.mock('../../src/lib/firebase.js', () => ({
  auth: {},
  db: {},
  firebaseConfigured: true,
  storage: {}
}));

vi.mock('firebase/auth', () => ({ signInWithCustomToken: vi.fn() }));

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => ({ currentUser: null, logOut: () => {}, userProfile: null })
}));

vi.mock('../../src/services/registrationService.js', () => ({
  createRegistration: (...args) => createRegistration(...args)
}));

vi.mock('../../src/hooks/useEventRegistration.js', () => ({
  useEventRegistration: () => ({
    displayedTermsVersion: '1',
    event: {
      capacityUnlimited: true,
      cost: 0,
      date: '2099-12-11',
      endTime: '16:30',
      eventType: 'Workshop',
      id: 'event-1',
      isPaid: false,
      registrationMode: 'now',
      startTime: '09:30',
      status: 'Published',
      title: 'Test Workshop'
    },
    eventError: '',
    loadingEvent: false,
    membershipSettings: { requireMembershipCheck: false }
  })
}));

vi.mock('../../src/hooks/useIdentityVerification.js', () => ({
  useIdentityVerification: () => ({
    accountVerified: false,
    authError: '',
    authPassword: '',
    authSubmitting: false,
    email: 'member@example.com',
    emailVerificationChallengeId: '',
    emailVerificationCode: '',
    emailVerificationError: '',
    emailVerificationMessage: '',
    emailVerificationSending: false,
    emailVerificationVerifying: false,
    emailVerified: true,
    handleEmailChange: () => {},
    handleEmailLookup: () => {},
    handlePasswordSignIn: () => {},
    handleStartEmailVerification: () => {},
    handleVerifyEmailCode: () => {},
    lookup: {
      allowNonMemberRegistration: true,
      profile: {
        billingAddress: {},
        email: 'member@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        membershipStatus: 'Active',
        name: 'Ada Lovelace',
        phone: '(865) 555-1234',
        // Active, or the page asks for the reactivation terms and the submit
        // never reaches createRegistration.
        status: 'Active'
      },
      profileExists: true,
      status: 'ok'
    },
    lookupComplete: true,
    lookupLoading: false,
    passwordSetupToken: '',
    reactivateProfile: () => {},
    reactivationTermsAccepted: false,
    registrationVerificationToken: 'token-1',
    runEmailLookup: () => {},
    setAuthError: () => {},
    setAuthPassword: () => {},
    setEmailVerificationCode: () => {},
    setEmailVerificationError: () => {},
    setReactivationTermsAccepted: () => {},
    showEmailVerification: false
  })
}));

// The identity hook above is mocked, so nothing calls applyProfile to copy
// the matched profile into the registrant fields - and the page's own
// validation would then refuse the submit on fields that are not even on
// screen for a matched member. Supplied filled instead.
vi.mock('../../src/hooks/useRegistrantForm.js', () => ({
  useRegistrantForm: () => ({
    applyProfile: () => {},
    billingCity: 'Loudon',
    billingCountry: 'United States',
    billingPostalCode: '37774',
    billingState: 'TN',
    billingStreet: '12 Awohili Drive',
    fieldErrors: {},
    firstName: 'Ada',
    lastName: 'Lovelace',
    phone: '(865) 555-1234',
    reset: () => {},
    setBillingCity: () => {},
    setBillingCountry: () => {},
    setBillingPostalCode: () => {},
    setBillingState: () => {},
    setBillingStreet: () => {},
    setFieldErrors: () => {},
    setFirstName: () => {},
    setLastName: () => {},
    setPhone: () => {}
  })
}));

vi.mock('../../src/hooks/usePaymentReservation.js', () => ({
  isPaymentReservationActive: () => false,
  usePaymentReservation: () => ({
    ensurePaymentReservation: () => Promise.resolve({
      paymentRequired: false,
      reservationId: 'hold-1',
      reservationToken: 'hold-token'
    }),
    isPaidEvent: false,
    joiningWaitlist: false,
    markReservationExpired: () => {},
    paymentRequiredForCurrentSeat: false,
    paymentReservation: null,
    paymentReservationError: '',
    paymentReservationExpired: false,
    paymentReservationLoading: false,
    releaseCurrentReservation: () => {},
    requiresSquarePayment: false,
    resetPaymentReservation: () => {},
    setSquareCard: () => {},
    setSquareWalletToken: () => {},
    squareCard: null,
    squareConfig: null,
    squareError: '',
    squareWalletToken: '',
    tokenizeSquarePayment: () => Promise.resolve('')
  })
}));

const { default: RegisterPage } = await import('../../src/pages/RegisterPage.jsx');

let assignedUrl = '';
let closeCalls = 0;
let originalLocation = null;

beforeEach(() => {
  assignedUrl = '';
  closeCalls = 0;
  createRegistration.mockClear();
  // jsdom's location.assign is non-configurable, so the whole object is
  // swapped rather than spied on. Restored in afterEach.
  originalLocation = window.location;
  delete window.location;
  window.location = {
    ...originalLocation,
    assign: (url) => {
      assignedUrl = url;
    },
    href: originalLocation.href,
    origin: originalLocation.origin
  };
  vi.spyOn(window, 'close').mockImplementation(() => {
    closeCalls += 1;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();

  if (originalLocation) {
    delete window.location;
    window.location = originalLocation;
    originalLocation = null;
  }

  document.body.className = '';
});

async function registerFrom(path) {
  const user = userEvent.setup();

  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/events" element={<div>Events list</div>} />
      </Routes>
    </MemoryRouter>
  );

  await user.click(await screen.findByRole('button', { name: /submit registration/i }));
  await waitFor(() => expect(createRegistration).toHaveBeenCalled());
  await screen.findByText('Registration Complete');

  return user;
}

describe('the registration confirmation page', () => {
  it('carries no nav of any kind', async () => {
    await registerFrom('/register?eventId=event-1');

    // The class the site header, the identity row and the Support footer link
    // all hide behind. Terms and Privacy stay: a page that took a card
    // payment is expected to carry those two.
    expect(document.body.classList.contains('signup-standalone')).toBe(true);
    // And no breadcrumb either - that was three more links out of the page.
    expect(screen.queryByText('Programs & Activities')).toBeNull();
  });

  it('offers one way out, reading "Return"', async () => {
    await registerFrom('/register?eventId=event-1');

    expect(screen.getByRole('button', { name: /^return$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /return to list/i })).toBeNull();
  });

  it('goes back to the guild page it was opened from', async () => {
    const user = await registerFrom(
      '/register?eventId=event-1&returnUrl=https%3A%2F%2Fvillagequilters.com%2Fworkshops'
    );

    await user.click(screen.getByRole('button', { name: /^return$/i }));

    expect(assignedUrl).toBe('https://villagequilters.com/workshops');
    expect(screen.queryByText('Events list')).toBeNull();
  });

  it('ends on a page they can close when there is nowhere to send them', async () => {
    const user = await registerFrom('/register?eventId=event-1');

    await user.click(screen.getByRole('button', { name: /^return$/i }));

    // Tried, because it is the cleanest outcome for a tab the app opened.
    expect(closeCalls).toBe(1);
    // It does nothing for a target="_blank" tab, which is most of them, so
    // the terminal card is what the member actually sees - and it is not the
    // app's event list.
    expect(await screen.findByText('Thank You')).toBeInTheDocument();
    expect(screen.getByText(/you can close this window/i)).toBeInTheDocument();
    expect(screen.queryByText('Events list')).toBeNull();
  });
});
