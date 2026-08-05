import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';

// Vercel's Hobby plan caps a deployment at 12 Serverless Functions, and every
// .js file directly under api/ is one. api/_lib is a directory of shared
// modules, not endpoints, so it does not count.
//
// This exists because a thirteenth file was added and the deploy failed with
// "No more than 12 Serverless Functions can be added to a Deployment on the
// Hobby plan" - after the commit had already been merged. A build that passes
// locally tells you nothing about this, so the limit is asserted here instead.
//
// At the cap, a new endpoint means folding the work into an existing file as
// another `action` branch (see handleAuthStatus in admin-update-user-profile.js)
// or moving off Hobby. If the plan changes, raise the number and say so here.
const HOBBY_PLAN_FUNCTION_LIMIT = 12;

test('api/ stays within the Hobby plan function limit', () => {
  const functions = readdirSync(new URL('../api', import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => entry.name)
    .sort();

  assert.ok(
    functions.length <= HOBBY_PLAN_FUNCTION_LIMIT,
    `api/ has ${functions.length} serverless functions, over the limit of `
      + `${HOBBY_PLAN_FUNCTION_LIMIT}. Vercel will refuse the deployment.\n`
      + `  ${functions.join('\n  ')}`
  );
});
