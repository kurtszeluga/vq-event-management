import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const vercelConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL('../vercel.json', import.meta.url)), 'utf8')
);

function cspDirectives() {
  const header = vercelConfig.headers
    .flatMap((entry) => entry.headers)
    .find((entry) => entry.key === 'Content-Security-Policy');

  assert.ok(header, 'no Content-Security-Policy header is configured');

  return Object.fromEntries(
    header.value
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...sources] = part.split(/\s+/);
        return [name, sources];
      })
  );
}

// Square's Web Payments SDK pulls from web.squarecdn.com through four
// different directives, and a gap in any one of them breaks card payment with
// a message that names none of this: "An unexpected error occurred while using
// Card". That is what happened - style-src was missing, so
// .../card-wrapper.css was blocked, the stylesheet's onerror rejected the
// attach, and the card form rendered as an empty box on the live site.
//
// Nothing else in the repo reads this file, so a missing directive passes
// lint, the build and every other test.
test('the CSP lets Square load everything its card form needs', () => {
  const directives = cspDirectives();

  for (const directive of ['script-src', 'style-src', 'connect-src', 'frame-src']) {
    assert.ok(
      directives[directive]?.includes('https://web.squarecdn.com'),
      `${directive} does not allow https://web.squarecdn.com - card payment will fail`
    );
  }
});

// Each of these was blocked on the live site and reported from the browser
// console, one host at a time. They are listed by what breaks when they are
// missing, because the symptom never names the host: a blocked font or icon
// leaves the wallet sheet half-rendered, and a blocked pay.js means Google
// Pay never appears at all.
test('the CSP allows the hosts Square and Google Pay actually fetch from', () => {
  const directives = cspDirectives();
  const required = {
    // Square Sans, SQ Market and Cash Sans, three separate hosts.
    'font-src': [
      'https://square-fonts-production-f.squarecdn.com',
      'https://d1g145x70srn7h.cloudfront.net',
      'https://cash-f.squarecdn.com'
    ],
    // The card form's info icon, and - the whole reason Google Pay's button
    // looked blank - the Google Pay button itself. Google's pay.js draws no
    // text: every variant of the button, the long ones with "Buy with G Pay"
    // included, is a single background-image SVG per colour and locale served
    // from www.gstatic.com/instantbuy/svg/. Block that host and the button
    // still renders, still sizes itself, still takes the click - with nothing
    // drawn on it, which is exactly how the Apple Pay button failed for a
    // different reason - see tests/apple-pay-button-style.test.js.
    'img-src': ['https://web.squarecdn.com', 'https://www.gstatic.com'],
    // Google Pay's SDK, and the gapi iframe Firebase Auth loads.
    'script-src': ['https://pay.google.com', 'https://apis.google.com']
  };

  for (const [directive, hosts] of Object.entries(required)) {
    for (const host of hosts) {
      assert.ok(
        directives[directive]?.includes(host),
        `${directive} does not allow ${host}`
      );
    }
  }
});

test('the CSP allows the Firebase Auth iframe', () => {
  // Firebase Auth loads an iframe from <project>.firebaseapp.com. Blocking it
  // is not a payment problem but it surfaced in the same console dump, and a
  // wildcard covers both the production and test projects rather than naming
  // one and breaking the other.
  const directives = cspDirectives();

  assert.ok(
    directives['frame-src']?.includes('https://*.firebaseapp.com'),
    'frame-src does not allow the Firebase Auth iframe'
  );
});

test('the sandbox host is allowed wherever the live one is', () => {
  // Preview deploys run against Square sandbox, which serves from a different
  // host; allowing only one of the pair breaks whichever environment is not
  // the one being tested at the time.
  const directives = cspDirectives();

  for (const directive of ['script-src', 'style-src', 'connect-src', 'frame-src']) {
    assert.ok(
      directives[directive]?.includes('https://sandbox.web.squarecdn.com'),
      `${directive} allows the live Square host but not the sandbox one`
    );
  }
});
