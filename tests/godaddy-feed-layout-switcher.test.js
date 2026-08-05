import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

// Same constraint as godaddy-feed-date-format.test.js: the embed is a
// standalone IIFE served as a static asset and touches `document` the moment it
// runs, so nothing in it can be imported. Lift the pure helpers out of the
// source and compile those instead.

const SOURCE = readFileSync(new URL('../public/godaddy-event-feed.js', import.meta.url), 'utf8');

function extractBlock(startPattern, closer) {
  const start = SOURCE.indexOf(startPattern);

  assert.notEqual(start, -1, `expected to find ${startPattern} in the embed`);

  const end = SOURCE.indexOf(closer, start);

  assert.notEqual(end, -1, `expected ${startPattern} to be closed`);

  return SOURCE.slice(start, end + closer.length);
}

const parseLayoutSwitcher = new Function(`
  ${extractBlock('const LAYOUTS = [', '];')}
  const DEFAULTS = { layoutSwitcher: false };
  ${extractBlock('function parseLayoutSwitcher(', '\n  }')}
  ${extractBlock('function parseLayoutList(', '\n  }')}
  return parseLayoutSwitcher;
`)();

test('a missing attribute leaves the switcher off', () => {
  assert.equal(parseLayoutSwitcher(undefined), false);
});

test('a bare attribute offers every layout', () => {
  // `data-layout-switcher` with no value arrives as an empty string.
  assert.deepEqual(parseLayoutSwitcher(''), ['roster', 'grid', 'agenda']);
});

test('the off words still turn it back off', () => {
  ['false', '0', 'off', 'no', 'OFF', ' false '].forEach((value) => {
    assert.equal(parseLayoutSwitcher(value), false, `${value} should disable the switcher`);
  });
});

test('a list narrows the row to those layouts, in the order given', () => {
  assert.deepEqual(parseLayoutSwitcher('grid,roster'), ['grid', 'roster']);
  assert.deepEqual(parseLayoutSwitcher('roster, grid'), ['roster', 'grid']);
});

test('unknown entries and duplicates are dropped rather than rendered', () => {
  assert.deepEqual(parseLayoutSwitcher('grid,GRID,tiles'), ['grid']);
});

test('a list of nothing recognised falls back to every layout', () => {
  // A typo must not silently strip the row down to one button.
  assert.deepEqual(parseLayoutSwitcher('tiles,cards'), ['roster', 'grid', 'agenda']);
});

test('a one-layout switcher renders no controls', () => {
  // buildLayoutSwitcherMarkup bails under two, the same as the view pills.
  assert.match(
    SOURCE,
    /const layouts = config\.layoutSwitcher \|\| \[\];[\s\S]{0,220}?if \(layouts\.length < 2\)/,
    'expected the switcher markup to bail on fewer than two layouts'
  );
});

test('a default layout outside the switcher list is corrected', () => {
  // Otherwise every button renders unpressed while the list uses a layout the
  // reader has no pill for.
  assert.match(
    SOURCE,
    /if \(config\.layoutSwitcher && !config\.layoutSwitcher\.includes\(config\.layout\)\) \{\s*config\.layout = config\.layoutSwitcher\[0\];/,
    'expected initFeed to fall back to the first offered layout'
  );
});

// A card is a wrapping flex row: in the grid layout the media takes a full
// line and the body wraps under it. A CSS grid row stretches every card to the
// tallest one, so without packing the lines to the top the leftover height is
// shared between them and shows up as a gap under the photo. It is worst on the
// shortest card - a Lecture, which carries no seats or registration rows - and
// that is how it was reported.
test('a wrapping card packs its lines to the top', () => {
  const cardRule = SOURCE.slice(
    SOURCE.indexOf('.vq-feed-card {'),
    SOURCE.indexOf('}', SOURCE.indexOf('.vq-feed-card {'))
  );

  assert.match(cardRule, /flex-wrap:\s*wrap/, 'the card wraps, which is what makes this possible');
  assert.match(
    cardRule,
    /align-content:\s*flex-start/,
    'without this the stretched height is shared between the wrapped lines'
  );
});

// Both image wrappers are <button>s. A button is sized by its content and
// carries UA border and padding, so each needs the same reset - otherwise a
// card with several photos and a card with one render their images at
// different widths side by side in the grid.
test('both image wrappers reset the browser button box', () => {
  ['.vq-feed-carousel-image-button', '.vq-feed-thumb-link'].forEach((selector) => {
    const start = SOURCE.indexOf(`${selector} {`);

    assert.notEqual(start, -1, `expected a rule for ${selector}`);

    const rule = SOURCE.slice(start, SOURCE.indexOf('}', start));

    assert.match(rule, /border:\s*0/, `${selector} must drop the UA border`);
    assert.match(rule, /padding:\s*0/, `${selector} must drop the UA padding`);
    assert.match(rule, /width:\s*100%/, `${selector} must fill its container`);
  });
});
