import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Why this exists: the member who tested a card payment on 2026-11-21 pressed
// "Return To List" on the confirmation page and landed on the app's own events
// page, not back on the guild website. The returnUrl parameter that would have
// sent them back was never on the register link.
//
// The cause is where the feed runs. GoDaddy renders every HTML block into an
// iframe[srcdoc], and inside that frame window.location.href reads
// "about:srcdoc" - not an http(s) address, so it was rejected and no parameter
// was sent. The register link also carries rel="noreferrer", so document.referrer
// on the app side is not a second chance at it.
//
// Same constraint as the other embed tests: the file is a standalone IIFE that
// touches `document` on load, so the helpers are lifted out and compiled.

const SOURCE = readFileSync(new URL('../public/godaddy-event-feed.js', import.meta.url), 'utf8');

function extractBlock(startPattern, closer) {
  const start = SOURCE.indexOf(startPattern);

  assert.notEqual(start, -1, `expected to find ${startPattern} in the embed`);

  const end = SOURCE.indexOf(closer, start);

  assert.notEqual(end, -1, `expected ${startPattern} to be closed`);

  return SOURCE.slice(start, end + closer.length);
}

const buildGetEmbeddingPageUrl = new Function('window', 'document', `
  ${extractBlock('function getEmbeddingPageUrl(', '\n  }')}
  ${extractBlock('function getSafeReturnUrl(', '\n  }')}
  return getEmbeddingPageUrl;
`);

function run({ baseURI, href, parentHref, parentThrows = false }) {
  const window = { location: { href } };

  window.parent = parentThrows
    ? new Proxy({}, {
      get(target, key) {
        if (key === 'location') {
          throw new Error('cross-origin');
        }

        return target[key];
      }
    })
    : parentHref === undefined
      ? window
      : { location: { href: parentHref } };

  return buildGetEmbeddingPageUrl(window, { baseURI })();
}

test('an ordinary page uses its own address', () => {
  assert.equal(
    run({ baseURI: 'https://villagequilters.com/programs', href: 'https://villagequilters.com/programs' }),
    'https://villagequilters.com/programs'
  );
});

test("a srcdoc iframe falls back to the holding page's base URL", () => {
  // The live case. about:srcdoc is not http(s), so it is skipped and the
  // inherited base URL - the GoDaddy page itself - answers instead.
  assert.equal(
    run({
      baseURI: 'https://villagequilters.com/workshops',
      href: 'about:srcdoc',
      parentHref: 'https://villagequilters.com/workshops'
    }),
    'https://villagequilters.com/workshops'
  );
});

test('a frame with no usable base URL reads the parent instead', () => {
  assert.equal(
    run({
      baseURI: 'about:srcdoc',
      href: 'about:srcdoc',
      parentHref: 'https://villagequilters.com/challenges'
    }),
    'https://villagequilters.com/challenges'
  );
});

test('a cross-origin parent is not an error, just no answer', () => {
  // Reading window.parent.location across origins throws. The feed must keep
  // rendering: no returnUrl is a worse Return button, not a blank page.
  assert.equal(
    run({ baseURI: 'about:srcdoc', href: 'about:srcdoc', parentThrows: true }),
    ''
  );
});

test('a javascript: address is never handed back as a return target', () => {
  // It becomes a link the member clicks, so the scheme check is a guard and
  // not tidiness.
  assert.equal(
    run({
      baseURI: 'javascript:alert(1)',
      href: 'javascript:alert(1)',
      parentHref: 'data:text/html,hello'
    }),
    ''
  );
});
