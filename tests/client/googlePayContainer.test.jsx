import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';

// Google Pay never appeared, in any browser, and said nothing about why.
//
// Square's googlePay.attach() renders the button INTO a container found by
// selector, so the container must already be on the page. It was rendered
// only when walletSupport.googlePay was true - which is set only after that
// attach succeeds. Neither could happen first, so attach was always handed a
// selector matching nothing.
//
// This test is written against the attach call rather than the rendered
// markup, because that is the thing that was broken: what it asserts is that
// by the time Square is asked to attach, the element exists.

const CONFIG = {
  applicationId: 'sandbox-sq0idb-test',
  enableApplePay: false,
  enableCardPayments: true,
  enableGooglePay: true,
  enabled: true,
  environment: 'sandbox',
  locationId: 'L1',
  scriptUrl: 'https://sandbox.web.squarecdn.com/v1/square.js'
};

let attachedSelectors;
let attachedOptions;
let containerAtAttach;

const { default: RegistrationPaymentPanel } =
  await import('../../src/components/RegistrationPaymentPanel.jsx');

beforeEach(() => {
  attachedSelectors = [];
  attachedOptions = [];
  containerAtAttach = [];

  const script = document.createElement('script');

  script.src = CONFIG.scriptUrl;
  script.dataset.loaded = 'true';
  document.head.appendChild(script);

  window.Square = {
    payments: () => ({
      applePay: () => Promise.reject(new Error('Apple Pay is only available on Safari.')),
      card: () => Promise.resolve({
        attach: () => Promise.resolve(),
        destroy: () => {}
      }),
      googlePay: () => Promise.resolve({
        attach: (selector, options) => {
          attachedSelectors.push(selector);
          attachedOptions.push(options);
          // The whole bug, captured: was the node actually there?
          containerAtAttach.push(document.querySelector(selector));
          return Promise.resolve();
        },
        destroy: () => {}
      }),
      paymentRequest: () => ({})
    })
  };
});

afterEach(() => {
  cleanup();
  document.querySelectorAll('script').forEach((node) => node.remove());
  delete window.Square;
});

it('has the Google Pay container on the page before Square attaches to it', async () => {
  render(
    <RegistrationPaymentPanel
      amountDue={11}
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

  await waitFor(() => expect(attachedSelectors.length).toBeGreaterThan(0));

  // Apple Pay rejected above, exactly as it does in Firefox and Chrome, so
  // nothing else can have put this container on the page.
  expect(containerAtAttach[0]).not.toBeNull();
  expect(attachedSelectors[0]).toMatch(/^#/);
});

// Square's defaults for these are undocumented and produce a narrow,
// icon-only button, which is what shipped: the G Pay mark alone, sized to
// itself, sitting beside a full-width Apple Pay bar. Asserted here because
// the only symptom is pixels - every other test passed with the defaults, and
// so did lint and the build.
it('asks Square for a full-width button with the wording on it', async () => {
  render(
    <RegistrationPaymentPanel
      amountDue={11}
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

  await waitFor(() => expect(attachedSelectors.length).toBeGreaterThan(0));

  // 'short' is the icon-only variant and 'static' sizes to content; it is the
  // pairing of 'long' with 'fill' that matches the Apple Pay button.
  expect(attachedOptions[0]).toMatchObject({
    buttonSizeMode: 'fill',
    buttonType: 'long'
  });
});
