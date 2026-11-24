// What the footer shows. Not a version number: the commit this bundle was
// built from, injected by vite.config.js as __APP_COMMIT_SHA__.
//
// The point is answering "is the change I asked for in what I am looking at",
// which a hand-maintained number never did - the one before this read
// "Beta 1.1" for 195 commits. A SHA also lets anyone reading a bug report map
// a screenshot straight back to the code.
//
// `typeof` rather than a bare reference: under vitest there is no define, so
// the identifier is undeclared, and only typeof is safe on one of those.
const commitSha = typeof __APP_COMMIT_SHA__ === 'string' ? __APP_COMMIT_SHA__ : '';

export const APP_VERSION = commitSha ? `Build: ${commitSha}` : 'Build: local';
