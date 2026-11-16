import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const FEED_PATH = fileURLToPath(new URL('../public/godaddy-event-feed.js', import.meta.url));

// This file ships to the guild's own website, and nothing else in the toolchain
// looks at it. eslint.config.js ignores it by name, Vite copies public/ through
// verbatim without parsing, and no other test imports it - so a syntax error in
// it passes lint, passes the build, passes every other test, and takes the live
// events list down.
//
// That is not hypothetical. A /* ... */ comment written inside the stylesheet
// template literal is not a JavaScript comment at all - it is CSS text, and
// everything in it is literal string content. Writing `contain` with backticks
// in one therefore closed the template literal, broke the parse, and blanked
// the feed on villagequilters.com until someone noticed and said so.
//
// Note the asymmetry that makes this easy to get wrong: the same backticks in
// a // comment at the top level are harmless, and this file has eleven of
// them. Only the ones inside a template literal matter, which is why this
// parses the file rather than scanning it for characters.
//
// Compiled, not executed: vm.Script parses and compiles without running, so
// this needs no DOM and cannot have side effects.
test('the GoDaddy feed script parses', () => {
  const source = readFileSync(FEED_PATH, 'utf8');

  assert.doesNotThrow(
    () => new vm.Script(source, { filename: 'godaddy-event-feed.js' }),
    'public/godaddy-event-feed.js does not parse - the live guild website would render nothing'
  );
});
