import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const stylesheet = readFileSync(
  fileURLToPath(new URL('../src/styles.css', import.meta.url)),
  'utf8'
);

// Returns the declarations of a rule in source order, so a later declaration
// overriding an earlier one is visible rather than averaged away.
function declarationsFor(selector) {
  const start = stylesheet.indexOf(`${selector} {`);

  assert.notEqual(start, -1, `${selector} is not in src/styles.css`);

  const body = stylesheet.slice(
    start + selector.length + 2,
    stylesheet.indexOf('}', start)
  );

  return body
    .split(';')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [property, ...value] = line.split(':');
      return [property.trim(), value.join(':').trim()];
    });
}

// Safari paints the Apple Pay logo and wording itself, and only while the
// button's appearance is -apple-pay-button. Nothing in the app renders that
// text, so losing the native appearance does not fail a render test, change
// the DOM or break a click - it leaves a black bar with nothing written on
// it, which is indistinguishable from Apple Pay never having loaded.
//
// That is what happened: an `appearance: none` sat four lines below the
// -webkit-appearance that asked for the button. Safari treats the two as one
// property, so the reset won.
test('the Apple Pay button keeps its native Apple Pay appearance', () => {
  const declarations = declarationsFor('.square-apple-pay-button');
  const appearance = declarations
    .filter(([property]) => property === 'appearance' || property === '-webkit-appearance');

  assert.ok(appearance.length > 0, 'the Apple Pay button sets no appearance at all');

  for (const [property, value] of appearance) {
    assert.equal(
      value,
      '-apple-pay-button',
      `${property} is "${value}" - Safari will draw a blank black bar instead of the Apple Pay button`
    );
  }
});

// The size Apple permits. Outside it Safari refuses to draw the button and
// falls back to the same blank box, so these are not cosmetic numbers.
test('the Apple Pay button is a height Apple will draw', () => {
  const height = declarationsFor('.square-apple-pay-button')
    .find(([property]) => property === 'height')?.[1];

  assert.ok(height, 'the Apple Pay button sets no height');

  const pixels = Number.parseInt(height, 10);

  assert.ok(
    pixels >= 30 && pixels <= 64,
    `the Apple Pay button is ${height}; Apple only renders 30px to 64px`
  );
});
