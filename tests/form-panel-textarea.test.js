import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const stylesheet = readFileSync(
  fileURLToPath(new URL('../src/styles.css', import.meta.url)),
  'utf8'
);

// A textarea's default font is the browser's own rather than the page's -
// smaller than the surrounding type, and monospace on most browsers. input
// and select were given `font: inherit` here and textarea was left out of the
// selector list, so the one multi-line field on the registration form (the
// Membership skills box) rendered in visibly smaller type than every field
// above it.
//
// Nothing in the repo reads this stylesheet, and no render test checks a
// computed font, so dropping textarea from this list again would pass lint,
// the build and every other test.
test('a textarea on a form panel is styled like every other field', () => {
  const rule = stylesheet
    .slice(stylesheet.indexOf('.form-panel input,'))
    .slice(0, stylesheet.slice(stylesheet.indexOf('.form-panel input,')).indexOf('}') + 1);

  assert.match(
    rule,
    /\.form-panel textarea/,
    'textarea is missing from the .form-panel field rule - it will fall back to the browser font'
  );
  assert.match(rule, /font:\s*inherit/, 'the .form-panel field rule no longer sets font: inherit');
});

test('a textarea cannot be dragged outside the panel it sits in', () => {
  // The panel is a fixed max-width; a horizontally resizable textarea escapes
  // it. Height is the dimension anyone actually wants.
  // lastIndexOf, not indexOf: the shared field rule above ends with
  // `.form-panel textarea {` as the last selector in its list, so searching
  // forwards finds that rule's body instead of this one.
  const start = stylesheet.lastIndexOf('.form-panel textarea {');

  assert.notEqual(start, -1, 'no .form-panel textarea rule');
  assert.match(
    stylesheet.slice(start, stylesheet.indexOf('}', start)),
    /resize:\s*vertical/
  );
});
