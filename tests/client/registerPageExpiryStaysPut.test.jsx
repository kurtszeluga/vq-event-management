import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';

// The reported behaviour: a payment page left idle threw the member to the
// event listing. Everything they had typed went with it, and on a standalone
// Membership signup the listing does not even show Membership, so there was
// no route back to the page they had been on.
//
// This drives the real page to the real expiry: the countdown inside
// SeatHoldStatus is not mocked, only the data it counts against.

vi.mock('../../src/components/RegistrationPaymentPanel.jsx', () => ({
  default: () => <div data-testid="payment-panel">card field</div>
}));

vi.mock('../../src/lib/firebase.js', () => ({
  auth: {},
  db: {},
  firebaseConfigured: true,
  storage: {}
}));

vi.mock('../../src/context/useAuth.js', () => ({
  useAuth: () => ({ currentUser: null, userProfile: null })
}));

vi.mock('../../src/hooks/useEventRegistration.js', () => ({
  useEventRegistration: () => ({
    displayedTermsVersion: '1',
    event: {
      cost: 25,
      eventType: 'Workshop',
      id: 'event-1',
      isPaid: true,
      registrationMode: 'now',
      status: 'Published',
      title: 'Test Workshop'
    },
    eventError: '',
    loadingEvent: false,
    membershipSettings: { requireMembershipCheck: false }
  })
}));

// Verified by email, so the form below the lookup actually renders - without
// this the page stops at the email box and SeatHoldStatus never mounts, which
// would make this test pass while proving nothing.
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
    lookup: { allowNonMemberRegistration: true, profileExists: false, status: 'ok' },
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

const markReservationExpired = vi.fn();

vi.mock('../../src/hooks/usePaymentReservation.js', () => ({
  usePaymentReservation: () => ({
    ensurePaymentReservation: () => Promise.resolve(null),
    isPaidEvent: true,
    joiningWaitlist: false,
    markReservationExpired,
    paymentRequiredForCurrentSeat: true,
    // Already past, so the countdown fires onExpired on its first tick.
    paymentReservation: { expiresAt: new Date(Date.now() - 1000).toISOString() },
    paymentReservationError: '',
    paymentReservationExpired: false,
    paymentReservationLoading: false,
    releaseCurrentReservation: () => {},
    requiresSquarePayment: true,
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

afterEach(() => {
  cleanup();
  markReservationExpired.mockClear();
});

it('leaves an idle registration where it is instead of returning to the listing', async () => {
  render(
    <MemoryRouter initialEntries={['/events/event-1/register']}>
      <Routes>
        <Route path="/events/:eventId/register" element={<RegisterPage />} />
        <Route path="/events" element={<div>Events list</div>} />
      </Routes>
    </MemoryRouter>
  );

  // Proves the form mounted and the expiry really ran. Without this the
  // assertion below would hold for a page that never got far enough to
  // navigate in the first place.
  await waitFor(() => expect(markReservationExpired).toHaveBeenCalled());

  // The old code waited 1.5 seconds and then left.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  expect(screen.queryByText('Events list')).toBeNull();
  expect(screen.getByTestId('payment-panel')).toBeInTheDocument();
});
