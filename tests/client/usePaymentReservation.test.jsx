import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/registrationService.js', () => ({
  beginSquareReservation: vi.fn(),
  loadSquarePaymentConfig: vi.fn()
}));

import {
  beginSquareReservation,
  loadSquarePaymentConfig
} from '../../src/services/registrationService.js';
import { usePaymentReservation } from '../../src/hooks/usePaymentReservation.js';

const PAID_EVENT = { cost: 25, isPaid: true, serviceFee: 1 };
const FREE_EVENT = { cost: 0, isPaid: false };

const REGISTRANT = {
  billingCity: 'Chapel Hill',
  billingCountry: 'United States',
  billingPostalCode: '27514',
  billingState: 'NC',
  billingStreet: '123 Main St',
  email: 'member@example.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  phone: '555-010-1000'
};

function activeHold(overrides = {}) {
  return {
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    paymentRequired: true,
    reservationId: 'hold-1',
    reservationToken: 'token-1',
    status: 'Active',
    ...overrides
  };
}

function setup(overrides = {}) {
  const props = {
    buildRegistrationRequest: vi.fn(() => ({ email: REGISTRANT.email, eventId: 'event-a' })),
    event: PAID_EVENT,
    eventId: 'event-a',
    paymentPreference: '',
    readyToReserve: false,
    registrant: REGISTRANT,
    ...overrides
  };

  const rendered = renderHook((next) => usePaymentReservation(next ?? props), {
    initialProps: props
  });

  return { props, ...rendered };
}

beforeEach(() => {
  // resetAllMocks, not clearAllMocks: clearAllMocks leaves implementations in
  // place, so a mockResolvedValue from one test would leak into the next.
  vi.resetAllMocks();
  loadSquarePaymentConfig.mockResolvedValue({ enabled: true, environment: 'sandbox' });
});

describe('the re-entrancy lock', () => {
  it('creates only one hold when called concurrently', async () => {
    // Seat holds count against capacity server-side. Without the lock, the
    // auto-reserve effect and an explicit submit could each create a hold and
    // silently consume two seats for one registrant.
    let releaseRequest;
    beginSquareReservation.mockImplementation(
      () => new Promise((resolve) => { releaseRequest = resolve; })
    );

    const { result } = setup();

    let first;
    let second;
    await act(async () => {
      first = result.current.ensurePaymentReservation();
      second = result.current.ensurePaymentReservation();
      releaseRequest(activeHold());
      await Promise.all([first, second]);
    });

    expect(beginSquareReservation).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toBe(null);
    await expect(first).resolves.toMatchObject({ reservationId: 'hold-1' });
  });

  it('releases the lock after a failure so a retry can still reserve', async () => {
    beginSquareReservation.mockRejectedValueOnce(new Error('Seat hold failed.'));
    const { result } = setup();

    await act(async () => {
      await expect(result.current.ensurePaymentReservation()).rejects.toThrow('Seat hold failed.');
    });

    expect(result.current.paymentReservationError).toBe('Seat hold failed.');
    expect(result.current.paymentReservationLoading).toBe(false);

    beginSquareReservation.mockResolvedValueOnce(activeHold());

    await act(async () => {
      await result.current.ensurePaymentReservation();
    });

    expect(beginSquareReservation).toHaveBeenCalledTimes(2);
    expect(result.current.paymentReservation).toMatchObject({ reservationId: 'hold-1' });
  });
});

describe('ensurePaymentReservation', () => {
  it('reuses a live hold instead of taking a second seat', async () => {
    beginSquareReservation.mockResolvedValue(activeHold());
    const { result } = setup();

    await act(async () => {
      await result.current.ensurePaymentReservation();
    });

    await act(async () => {
      await result.current.ensurePaymentReservation();
    });

    expect(beginSquareReservation).toHaveBeenCalledTimes(1);
  });

  it('takes a fresh hold when the existing one has already expired', async () => {
    const expired = activeHold({ expiresAt: new Date(Date.now() - 1000).toISOString() });
    beginSquareReservation.mockResolvedValueOnce(expired);
    const { result } = setup();

    await act(async () => {
      await result.current.ensurePaymentReservation();
    });

    beginSquareReservation.mockResolvedValueOnce(activeHold({ reservationId: 'hold-2' }));

    await act(async () => {
      await result.current.ensurePaymentReservation();
    });

    expect(beginSquareReservation).toHaveBeenCalledTimes(2);
  });

  it('does not reserve for a free event', async () => {
    const { result } = setup({ event: FREE_EVENT });

    await act(async () => {
      await expect(result.current.ensurePaymentReservation()).resolves.toBe(null);
    });

    expect(beginSquareReservation).not.toHaveBeenCalled();
  });

  it('does not reserve when paying by cash or check later', async () => {
    const { result } = setup({ paymentPreference: 'cash-check-later' });

    await act(async () => {
      await expect(result.current.ensurePaymentReservation()).resolves.toBe(null);
    });

    expect(beginSquareReservation).not.toHaveBeenCalled();
  });

  it('refuses to reserve again once the hold has been marked expired', async () => {
    const { result } = setup();

    act(() => {
      result.current.markReservationExpired();
    });

    await act(async () => {
      await expect(result.current.ensurePaymentReservation()).rejects.toThrow(/expired/i);
    });

    expect(beginSquareReservation).not.toHaveBeenCalled();
  });
});

describe('the auto-reserve effect', () => {
  it('takes a hold once the registrant is ready', async () => {
    beginSquareReservation.mockResolvedValue(activeHold());
    const { result } = setup({ readyToReserve: true });

    await waitFor(() => expect(result.current.paymentReservation).not.toBe(null));
    expect(beginSquareReservation).toHaveBeenCalledTimes(1);
  });

  it('does not take a hold before the registrant is ready', async () => {
    setup({ readyToReserve: false });

    await act(async () => {});

    expect(beginSquareReservation).not.toHaveBeenCalled();
  });

  it('does not re-reserve once a hold exists', async () => {
    beginSquareReservation.mockResolvedValue(activeHold());
    const { rerender, props } = setup({ readyToReserve: true });

    await waitFor(() => expect(beginSquareReservation).toHaveBeenCalledTimes(1));

    rerender({ ...props, readyToReserve: true });
    rerender({ ...props, readyToReserve: true });

    await act(async () => {});

    expect(beginSquareReservation).toHaveBeenCalledTimes(1);
  });

  it('does not auto-reserve a free event', async () => {
    setup({ event: FREE_EVENT, readyToReserve: true });

    await act(async () => {});

    expect(beginSquareReservation).not.toHaveBeenCalled();
  });
});

describe('hold invalidation', () => {
  it('drops the hold when the billing address changes', async () => {
    // A hold is bound server-side to an event, email, and exact amount.
    // Keeping a stale one across an identity or billing edit would be
    // rejected at submit with a confusing "hold expired" message.
    beginSquareReservation.mockResolvedValue(activeHold());
    const { props, rerender, result } = setup({ readyToReserve: false });

    await act(async () => {
      await result.current.ensurePaymentReservation();
    });

    expect(result.current.paymentReservation).not.toBe(null);

    rerender({
      ...props,
      registrant: { ...REGISTRANT, billingStreet: '456 Other St' }
    });

    expect(result.current.paymentReservation).toBe(null);
  });

  it('drops the hold when the email changes', async () => {
    beginSquareReservation.mockResolvedValue(activeHold());
    const { props, rerender, result } = setup({ readyToReserve: false });

    await act(async () => {
      await result.current.ensurePaymentReservation();
    });

    rerender({
      ...props,
      registrant: { ...REGISTRANT, email: 'someone-else@example.com' }
    });

    expect(result.current.paymentReservation).toBe(null);
  });

  it('drops the hold and the wallet token when the payment preference changes', async () => {
    beginSquareReservation.mockResolvedValue(activeHold());
    const { props, rerender, result } = setup({ readyToReserve: false });

    await act(async () => {
      await result.current.ensurePaymentReservation();
    });

    act(() => {
      result.current.setSquareWalletToken('cnon:card-nonce-ok');
    });

    expect(result.current.squareWalletToken).toBe('cnon:card-nonce-ok');

    rerender({ ...props, paymentPreference: 'cash-check-later' });

    expect(result.current.paymentReservation).toBe(null);
    expect(result.current.squareWalletToken).toBe('');
  });

  it('keeps the hold when unrelated values are unchanged', async () => {
    beginSquareReservation.mockResolvedValue(activeHold());
    const { props, rerender, result } = setup({ readyToReserve: false });

    await act(async () => {
      await result.current.ensurePaymentReservation();
    });

    rerender({ ...props, registrant: { ...REGISTRANT } });

    expect(result.current.paymentReservation).toMatchObject({ reservationId: 'hold-1' });
  });
});

describe('derived payment state', () => {
  it('reports a waitlisted hold as not requiring payment', async () => {
    beginSquareReservation.mockResolvedValue(
      activeHold({ paymentRequired: false, status: 'Waitlisted' })
    );
    const { result } = setup();

    await act(async () => {
      await result.current.ensurePaymentReservation();
    });

    expect(result.current.joiningWaitlist).toBe(true);
    expect(result.current.paymentRequiredForCurrentSeat).toBe(false);
  });

  it('requires payment for a paid event before any hold exists', () => {
    const { result } = setup();

    expect(result.current.requiresSquarePayment).toBe(true);
    expect(result.current.paymentRequiredForCurrentSeat).toBe(true);
  });
});

describe('Square configuration', () => {
  it('reports a disabled Square configuration', async () => {
    loadSquarePaymentConfig.mockResolvedValue({ enabled: false });
    const { result } = setup();

    await waitFor(() => expect(result.current.squareError).toMatch(/not configured/i));
  });

  it('surfaces a configuration load failure', async () => {
    loadSquarePaymentConfig.mockRejectedValue(new Error('Square config unavailable.'));
    const { result } = setup();

    await waitFor(() => expect(result.current.squareError).toBe('Square config unavailable.'));
    expect(result.current.squareConfig).toBe(null);
  });

  it('does not load Square configuration for a free event', async () => {
    setup({ event: FREE_EVENT });

    await act(async () => {});

    expect(loadSquarePaymentConfig).not.toHaveBeenCalled();
  });
});

describe('tokenizeSquarePayment', () => {
  it('prefers an already-authorized wallet token over the card field', async () => {
    const { result } = setup();

    act(() => {
      result.current.setSquareWalletToken('wallet-token');
    });

    await act(async () => {
      await expect(result.current.tokenizeSquarePayment()).resolves.toBe('wallet-token');
    });
  });

  it('fails clearly when no card is attached', async () => {
    const { result } = setup();

    await act(async () => {
      await expect(result.current.tokenizeSquarePayment()).rejects.toThrow(/not ready/i);
    });
  });

  it('sends the full amount due including the service fee', async () => {
    const tokenize = vi.fn().mockResolvedValue({ status: 'OK', token: 'card-token' });
    const { result } = setup();

    act(() => {
      result.current.setSquareCard({ tokenize });
    });

    await act(async () => {
      await expect(result.current.tokenizeSquarePayment()).resolves.toBe('card-token');
    });

    // 25 cost + 1 service fee
    expect(tokenize).toHaveBeenCalledWith(expect.objectContaining({ amount: '26.00' }));
    expect(tokenize).toHaveBeenCalledWith(expect.objectContaining({
      billingContact: expect.objectContaining({
        city: 'Chapel Hill',
        email: 'member@example.com',
        familyName: 'Lovelace',
        givenName: 'Ada',
        postalCode: '27514',
        state: 'NC'
      })
    }));
  });

  it('surfaces Square tokenization errors', async () => {
    const tokenize = vi.fn().mockResolvedValue({
      errors: [{ message: 'Card declined.' }],
      status: 'ERROR'
    });
    const { result } = setup();

    act(() => {
      result.current.setSquareCard({ tokenize });
    });

    await act(async () => {
      await expect(result.current.tokenizeSquarePayment()).rejects.toThrow('Card declined.');
    });
  });
});
