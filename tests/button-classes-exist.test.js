import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import test from 'node:test';

// A button rendered with a class the stylesheet has never heard of.
//
// `className="button-primary"` was written into ProfilePage for the email
// change. Nothing in the app defines `.button-primary` - every real button
// here is `button-link button-reset` - so it fell back to the browser's
// default and rendered as a small plain control beside the proper 44px pills.
// Reported as "the send code blue pill is still small", and the second thing
// in this project to be invisible to lint, the build and every other test
// while being plainly wrong on screen. See tests/apple-pay-button-style.test.js
// and tests/form-panel-textarea.test.js for the same shape of bug.
//
// Deliberately narrow: only `button-*` names, of which there are two in the
// whole app. Checking every class would drag in dynamic and composed names and
// stop being a signal.

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const STYLES = fileURLToPath(new URL('../src/styles.css', import.meta.url));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);

    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }

    return /\.jsx?$/.test(entry) ? [full] : [];
  });
}

test('every button-* class a component renders is defined in styles.css', () => {
  const css = readFileSync(STYLES, 'utf8');
  const used = new Map();

  for (const file of sourceFiles(SRC)) {
    const text = readFileSync(file, 'utf8');

    for (const match of text.matchAll(/\bbutton-[a-z0-9-]+/g)) {
      if (!used.has(match[0])) {
        used.set(match[0], path.relative(SRC, file));
      }
    }
  }

  // If this drops to zero the regex has stopped matching and the test is
  // passing for the wrong reason.
  assert.ok(used.size >= 2, 'found no button-* classes at all - the scan is broken');

  for (const [className, file] of used) {
    assert.ok(
      css.includes(`.${className}`),
      `${file} renders "${className}" but styles.css defines no rule for it`
    );
  }
});

test('the pill every primary action uses still has its size', () => {
  // The symptom was a button that was the right colour and the wrong size, so
  // the colour alone is not what makes this class the pill. These two
  // declarations are what a bare browser button does not give you.
  const css = readFileSync(STYLES, 'utf8');
  const rule = /\.button-link \{([^}]*)\}/.exec(css);

  assert.ok(rule, 'styles.css no longer defines .button-link');
  assert.match(rule[1], /min-height:\s*44px/);
  assert.match(rule[1], /padding:/);
});
