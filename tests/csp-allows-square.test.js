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
