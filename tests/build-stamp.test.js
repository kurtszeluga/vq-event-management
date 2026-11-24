import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { APP_VERSION } from '../src/version.js';

// The footer used to carry a hand-maintained "Beta 1.1" that went 195 commits
// without being touched - a version that is wrong in a way nobody can notice
// is worse than none, because people act on it. It is now the commit the
// bundle was built from, stamped in by vite.config.js.
//
// These guard the two halves that have no other coverage: the resolver's
// order of preference, and the fact that the browser file must not reference
// the injected identifier in a way that throws where it is not defined.

test('with no define, it says local rather than crashing', () => {
  // This file runs under node with no Vite define at all, which is also what
  // the client test suite sees - vitest.config.js has no `define` either. A
  // bare reference to __APP_COMMIT_SHA__ would be a ReferenceError here.
  assert.equal(APP_VERSION, 'Build: local');
});

test('the browser file reads the identifier only through typeof', () => {
  const source = readFileSync(new URL('../src/version.js', import.meta.url), 'utf8');
  // Comments name the identifier too, and explaining it is not referencing it.
  const code = source.replace(/^\s*\/\/.*$/gm, '');
  const references = code.match(/__APP_COMMIT_SHA__/g) || [];

  assert.equal(references.length, 2, 'expected exactly the typeof guard and the read');
  assert.match(code, /typeof __APP_COMMIT_SHA__ === 'string'/);
  // The read must sit on the true branch of that guard, never on its own.
  assert.ok(
    !/[^.\w]__APP_COMMIT_SHA__/.test(code.replace(/typeof __APP_COMMIT_SHA__ === 'string' \? __APP_COMMIT_SHA__/, '')),
    'an unguarded reference would throw wherever the define is absent'
  );
});

test('the footer label is exactly "Build: " and a short sha', () => {
  // Agreed wording on 2026-11-24: no "Beta", no date, no branch.
  assert.match(APP_VERSION, /^Build: /);
  assert.ok(!/beta/i.test(APP_VERSION));
});

test('the build config prefers Vercel, falls back to git, then to nothing', () => {
  const config = readFileSync(new URL('../vite.config.js', import.meta.url), 'utf8');

  // Order matters: a Vercel build has no .git to ask, and a local build has
  // no VERCEL_GIT_COMMIT_SHA, so each needs the other's fallback.
  const vercelAt = config.indexOf('VERCEL_GIT_COMMIT_SHA');
  const gitAt = config.indexOf('git rev-parse');

  assert.ok(vercelAt > -1, 'the Vercel commit variable is not read');
  assert.ok(gitAt > vercelAt, 'git must be the fallback, not the first choice');
  // Seven characters is what the footer shows and what git log --oneline
  // prints, so the two can be compared by eye.
  assert.match(config, /slice\(0, 7\)/);
  assert.match(config, /--short=7/);
  // A build with neither must produce no stamp rather than a wrong one.
  assert.match(config, /catch \{\s*return '';\s*\}/);
});
