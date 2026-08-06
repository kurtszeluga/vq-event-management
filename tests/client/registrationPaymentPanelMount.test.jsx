import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The Square card iframe failed to mount "fairly often" on first load with
// "An unexpected error occurred while using Card". It was never chased down
// because the sandbox Use Test Card button sidestepped the iframe entirely -
// but that button only renders in sandbox, so in production this is the only
// way anyone pays.
//
// Confirmed cause: the effect can run twice with a cleanup between - StrictMode
// does this on every mount in development, and a real re-run does it whenever
// config or amountDue arrives late. The container id is a ref, so both runs
// target the SAME DOM node, and without a cancellation check across the await
// in payments.card() the superseded run attaches too. Two Square card iframes
// in one container is what surfaces as "an unexpected error occurred while
// using Card".
//
// The StrictMode test below is the one that discriminates: remove the guard and
// it fails with two attaches instead of one. The others pin the surrounding
// invariants - no leaked instance, no throwing destroy - and pass either way.

const CONFIG = {
  applicationId: 'sandbox-sq0idb-test',
  enableApplePay: false,
  enableCardPayments: true,
  enableGooglePay: false,
  enabled: true,
  environment: 'sandbox',
  locationId: 'L1',
  scriptUrl: 'https://sandbox.web.squarecdn.com/v1/square.js'
};

let cardInstances;
let resolveCard;

function makeCard() {
  const instance = {
    attach: vi.fn(() => {
      instance.attachCalls.push(instance.destroyed);
      return Promise.resolve();
    }),
    attachCalls: [],
    destroy: vi.fn(() => {
      instance.destroyed = true;
    }),
    destroyed: false
  };

  cardInstances.push(instance);

  return instance;
}

const { default: RegistrationPaymentPanel } =
  await import('../../src/components/RegistrationPaymentPanel.jsx');

function renderPanel(props = {}) {
  return render(
    <RegistrationPaymentPanel
      amountDue={31}
      config={CONFIG}
      disabled={false}
      error=""
      onCardReady={() => {}}
      onEnsureReservation={() => Promise.resolve()}
      onWalletTokenReady={() => {}}
      onlinePaymentRequired
      selectedPaymentToken=""
      {...props}
    />
  );
}

beforeEach(() => {
  cardInstances = [];
  resolveCard = null;
  // The panel injects the Square script by URL; pretend it is already there so
  // loadSquareScript resolves without a network call.
  const script = document.createElement('script');

  script.src = CONFIG.scriptUrl;
  script.dataset.loaded = 'true';
  document.head.appendChild(script);

  window.Square = {
    payments: () => ({
      applePay: () => Promise.reject(new Error('not supported here')),
      card: () => new Promise((resolve) => {
        resolveCard = () => resolve(makeCard());
      }),
      googlePay: () => Promise.reject(new Error('not supported here')),
      paymentRequest: () => ({})
    })
  };
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('script').forEach((node) => node.remove());
  delete window.Square;
});

describe('mounting the Square card field', () => {
  // StrictMode mounts, unmounts and remounts in development, running the effect
  // twice with a cleanup between - the same interleaving a real re-run causes.
  // main.jsx wraps the app in it, so this is how the panel actually behaves for
  // anyone testing locally.
  it('attaches only once when the effect runs twice', async () => {
    const resolvers = [];

    window.Square = {
      payments: () => ({
        applePay: () => Promise.reject(new Error('not supported here')),
        card: () => new Promise((resolve) => {
          resolvers.push(() => resolve(makeCard()));
        }),
        googlePay: () => Promise.reject(new Error('not supported here')),
        paymentRequest: () => ({})
      })
    };

    render(
      <StrictMode>
        <RegistrationPaymentPanel
          amountDue={31}
          config={CONFIG}
          disabled={false}
          error=""
          onCardReady={() => {}}
          onEnsureReservation={() => Promise.resolve()}
          onWalletTokenReady={() => {}}
          onlinePaymentRequired
          selectedPaymentToken=""
        />
      </StrictMode>
    );

    await waitFor(() => expect(resolvers.length).toBeGreaterThan(1));
    resolvers.forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The container id is a ref, so every effect run targets the SAME DOM
    // node. Only the surviving run may attach to it - a superseded one
    // attaching too puts two Square card iframes into one container, which is
    // the most plausible source of "an unexpected error occurred while using
    // Card".
    const totalAttaches = cardInstances
      .reduce((count, instance) => count + instance.attachCalls.length, 0);

    expect(totalAttaches).toBe(1);
  });

  it('attaches the card once it is ready', async () => {
    renderPanel();

    await waitFor(() => expect(resolveCard).toBeTypeOf('function'));
    resolveCard();

    await waitFor(() => expect(cardInstances[0].attach).toHaveBeenCalled());
    expect(cardInstances[0].destroyed).toBe(false);
  });

  it('never attaches an instance that was already destroyed', async () => {
    // Passes with and without the guard - the discriminating case is the
    // StrictMode one above. Kept because it pins the invariant itself.
    const { rerender } = renderPanel();

    await waitFor(() => expect(resolveCard).toBeTypeOf('function'));

    const firstResolve = resolveCard;

    // amountDue is in the effect's dependency list, so this re-runs it.
    rerender(
      <RegistrationPaymentPanel
        amountDue={42}
        config={CONFIG}
        disabled={false}
        error=""
        onCardReady={() => {}}
        onEnsureReservation={() => Promise.resolve()}
        onWalletTokenReady={() => {}}
        onlinePaymentRequired
        selectedPaymentToken=""
      />
    );

    firstResolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const destroyedInstance = cardInstances[0];

    expect(destroyedInstance.destroyed).toBe(true);
    // attachCalls records whether the instance was already destroyed at the
    // moment attach ran, so a true here is the bug.
    expect(destroyedInstance.attachCalls).not.toContain(true);
  });

  it('destroys the card abandoned by a re-run rather than leaking its iframe', async () => {
    const { rerender } = renderPanel();

    await waitFor(() => expect(resolveCard).toBeTypeOf('function'));

    const firstResolve = resolveCard;

    rerender(
      <RegistrationPaymentPanel
        amountDue={42}
        config={CONFIG}
        disabled={false}
        error=""
        onCardReady={() => {}}
        onEnsureReservation={() => Promise.resolve()}
        onWalletTokenReady={() => {}}
        onlinePaymentRequired
        selectedPaymentToken=""
      />
    );

    firstResolve();
    await waitFor(() => expect(cardInstances[0].destroyed).toBe(true));
  });

  it('shows the member no error when a re-run causes the failure', async () => {
    const { rerender } = renderPanel();

    await waitFor(() => expect(resolveCard).toBeTypeOf('function'));

    const firstResolve = resolveCard;

    rerender(
      <RegistrationPaymentPanel
        amountDue={42}
        config={CONFIG}
        disabled={false}
        error=""
        onCardReady={() => {}}
        onEnsureReservation={() => Promise.resolve()}
        onWalletTokenReady={() => {}}
        onlinePaymentRequired
        selectedPaymentToken=""
      />
    );

    firstResolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(screen.queryByText(/unexpected error/i)).toBeNull();
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
  });

  it('survives a destroy that throws', async () => {
    // Square throws on a double destroy or a destroy before attach; that must
    // not escape a React cleanup and take the unmount with it.
    renderPanel();

    await waitFor(() => expect(resolveCard).toBeTypeOf('function'));
    resolveCard();
    await waitFor(() => expect(cardInstances[0].attach).toHaveBeenCalled());

    cardInstances[0].destroy = () => {
      throw new Error('Card was already destroyed');
    };

    expect(() => cleanup()).not.toThrow();
  });
});
