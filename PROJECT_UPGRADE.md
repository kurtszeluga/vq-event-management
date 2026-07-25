# VQ Event Management Upgrade Plan

This document tracks the security, reliability, usability, and product improvements identified during the July 2026 site review. Update the status and completion log whenever an item is finished so the remaining work stays visible.

## Status Key

- `Not Started`
- `In Progress`
- `Completed`
- `Deferred`

## Phase 1 - Registration Security

| Item | Status | Notes |
| --- | --- | --- |
| Stop returning member phone and billing address before identity verification | Completed | Public lookup returns only profile existence and the required verification step. Contact, membership, and billing details are returned only after verification. |
| Require Firebase authentication for signed-in/password users | Completed | The server verifies the Firebase ID token, registration email, and linked profile UID. |
| Replace phone-number fallback with a Resend one-time email code | Completed | Six-digit codes expire after 10 minutes, allow five attempts, limit sends, and are stored only as hashes. |
| Issue a short-lived, one-use registration verification token | Completed | Email verification issues a hashed, event-and-email-bound token that expires after 20 minutes and is consumed during registration. |
| Require verified identity in the registration API | Completed | Both member and permitted non-member registrations now require Firebase authentication or a valid email-verification token. |
| Deny direct browser creation of Firestore registration records | Completed | Firestore denies all client registration creates; the Firebase Admin API is the sole creation path. |
| Remove the obsolete public phone-verification endpoint | Completed | Removed the endpoint and client calls. After Phase 2 added `/api/square-webhook`, the Vercel API count is 12 (Hobby plan limit). |
| Add focused automated checks for registration verification | Completed | Five Node tests, changed-file lint, production build, rules compilation, and a direct-write denial smoke check pass. |

### Phase 1 Production Checklist

- [x] Push the application changes and confirm the Vercel deployment succeeds.
- [x] Publish `firestore.rules` to Firebase before testing registration.
- [x] Deploy the Firestore indexes; `firestore.indexes.json` now enables TTL for `registrationVerifications.expiresAt` so expired verification records are cleaned up automatically.
- [x] Test a signed-in member registration.
- [x] Test a profile/password registration and the email-code fallback.
- [x] Test a CSV-created profile that has no activated login.
- [x] Test an allowed non-member registration and a blocked non-member registration.
- [x] Confirm profile contact and billing information never appears before successful verification.
- [x] Confirm incorrect, expired, and reused verification codes/tokens are rejected.

## Phase 2 - Payment And Capacity Reliability

| Item | Status | Notes |
| --- | --- | --- |
| Add temporary seat reservations during online checkout | Completed | Online Square checkout now creates a private 5-minute event/email-bound reservation before tokenizing the card, counts active holds against capacity, and consumes the hold when the registration is written. |
| Add Square webhook signature verification | Completed | Added `/api/square-webhook`, HMAC signature verification, private `squareWebhookEvents` logging, and conservative payment/refund reconciliation hooks. |
| Add payment reconciliation tools | Completed | Added an admin Payment Review module and Needs Attention count for Square webhook events requiring review. |
| Initiate Square refunds from the app | Completed | Added the System Config toggle and guarded online Square refund action. Pending Square refunds cancel the registration immediately, return the seat, create Payment Review follow-up, send a registrant notification, and reconcile when Square webhook completion arrives. |
| Add payment and card-testing rate limits | Completed | Added Firestore-backed API rate limits for registration lookup, email-code sends, code verification, Square seat holds, registration submits, membership confirmation sends, admin payment updates, and refund requests. `apiRateLimits.expiresAt` is TTL-managed. |
| Enforce idempotency across registration retries | Completed | Registration submit attempts now carry a stable browser-generated attempt key, store a private `registrationAttempts` record, reuse existing results on retry, and send the same key to Square to avoid duplicate charges. |

## Phase 3 - Data Security And Permissions

| Item | Status | Notes |
| --- | --- | --- |
| Create a directory-safe member collection | Completed | Added `memberDirectoryProfiles` projection with sync on profile/membership writes, directory query switched off `users`, and Firestore rules that remove peer reads of full user documents. Run `npm run backfill:member-directory` after deploying rules. |
| Correct and test member-directory Firestore queries | Completed | Member directory query now includes both `status == Active` and `membershipStatus == Active`, matching Firestore rule requirements. |
| Restrict event file uploads to authorized event administrators | Completed | Storage rules now require an active Super User or Admin with `manageEvents`, and uploads remain limited to the signed-in user's own folder. |
| Route sensitive writes through authenticated server endpoints | In Progress | Event create/update/archive/reactivate/delete and admin password changes now go through authenticated Admin APIs; client event writes are denied. Remaining: membership CSV/import and some configuration writes are still client-side. |
| Add API rate limiting and abuse monitoring | Completed | Extended Firestore-backed rate limits to `file-proxy`, public feeds/counts, supply-list viewer, admin user create/update, and event management. Monitoring/alerts remain a later ops item. |
| Add production security headers | Completed | Added CSP, frame protection, referrer policy, content-type protection, and permissions policy via `vercel.json`. |
| Add a privacy policy and support/contact page | Completed | Added `/privacy` and `/support` pages plus footer links. |

## Phase 4 - Event And Registration Workflows

| Item | Status | Notes |
| --- | --- | --- |
| Enforce registration opening and closing dates automatically | Not Started | Server and all listing views should derive availability from configured dates. |
| Add secure guest Manage My Registration links | Not Started | Allow guests to review or cancel without creating an account. |
| Add automatic waitlist promotion | Not Started | Send the next person a time-limited registration/payment link when a seat opens. |
| Add calendar files and reminder emails | Not Started | Include add-to-calendar, one-week, one-day, cancellation, and location-change notices. |
| Add Duplicate Event and reusable event templates | Not Started | Reduce data entry for recurring programs and workshops. |
| Add coordinator-area permissions | Not Started | Coordinators should manage only their assigned areas when appropriate. |
| Add attendance and roster tools | Not Started | Include printable rosters, CSV export, and optional check-in. |

## Phase 5 - Admin Operations

| Item | Status | Notes |
| --- | --- | --- |
| Build a unified Needs Attention queue | Not Started | Pending memberships, unpaid registrations, failed payments, waitlists, email bounces, and incomplete upcoming events. |
| Add an admin activity-log viewer | Not Started | Audit records already exist but are not visible in the application. |
| Add operational and financial reports | Not Started | Event totals, outstanding payments, cash/check deposits, Square totals, refunds, attendance, and membership renewals. |
| Add Resend delivery and bounce tracking | Not Started | Display failures and suppress repeatedly invalid addresses. |
| Add CSV import preview and rollback support | Not Started | Prevent partial annual-refresh imports and make changes reviewable before committing. |
| Add scheduled Firestore backups and a recovery procedure | Not Started | Document restore steps and test them periodically. |

## Phase 6 - Member Experience And Accessibility

| Item | Status | Notes |
| --- | --- | --- |
| Add compact mobile navigation | Not Started | Prevent the sticky navigation from consuming too much phone screen space. |
| Increase small labels and helper text | Not Started | Target at least 14px supporting text and 16px form controls. |
| Add consistent keyboard focus and dialog focus management | Not Started | Include Escape-to-close and restore focus to the opening control. |
| Make directory email and phone values clickable | Not Started | Use `mailto:` and `tel:` links. |
| Replace raw Firebase errors with plain-language messages | Not Started | Apply across login, profile, registration, and admin screens. |
| Add directory print/export support | Not Started | Support the Guild's current member-directory distribution workflow. |
| Update favicon and PWA icons to the supplied Guild logo | Not Started | Current installed-app icons still use the old VQ Events artwork. |

## Phase 7 - Engineering And Deployment

| Item | Status | Notes |
| --- | --- | --- |
| Add automated Firestore rules and workflow tests | In Progress | Capacity, seat holds, payment-hold validation, and Square refund-side webhook detection are covered by 19 tests in `tests/registration-capacity.test.js` and `tests/square-reconciliation.test.js`. Client-side hook tests now exist too (`tests/client/`, vitest). Remaining: Firestore rules tests, membership eligibility, and CSV import. |
| Add continuous integration for build, lint, and tests | Completed | `.github/workflows/ci.yml` runs lint, build, server tests, and client tests on push to `main` and all pull requests. Matrix is `[24.x]`, matching the Vercel runtime declared in `engines.node`; `fail-fast: false` so one entry cannot mask another. |
| Fix current source lint errors and ignore generated `.vercel` files | Completed | Added `.vercel` to ESLint ignores, fixed the four real source errors, and resolved the `EventForm` exhaustive-deps warning. `npm run lint` is clean. |
| Resolve dependency audit findings | In Progress | `npm audit fix` (non-force) applied: fixed `fast-uri`, `fast-xml-parser`, and `postcss` (25 findings to 22), lockfile-only, no `package.json` ranges changed. Remaining 22 reviewed individually rather than forced: `react-router` (high, CSRF) has no 7.x patch - fixed only at 8.3.0+ - and the advisory states it only affects apps using react-router's unstable RSC APIs, which this app does not use; accepted as not applicable rather than forcing a major router bump. The other 21 (`brace-expansion` chain, `uuid`) are pinned entirely inside `firebase-admin@14.2.0` (the latest published version) via `google-gax` and `@google-cloud/storage` - Google's own dependency choices, not resolvable by bumping our `package.json`. `firebase-admin` is server-only (confirmed: not imported anywhere in `src/`), and `rimraf`/`glob` inside `google-gax` run only for internal SDK file cleanup, not on any user-reachable path. Do not run `npm audit fix --force`: it downgrades `firebase-admin` to 10.3.0, upgrades ESLint past the `eslint-plugin-react-hooks@5` peer range, and surfaces a new `protobufjs` chain - a net loss. Re-check when `firebase-admin` publishes past 14.2.0. |
| Split oversized components and services | In Progress | `RegisterPage` domain extraction is essentially done. Step 0 moved derived eligibility/verification gates to `src/utils/registrationEligibility.js`; steps 1-4 moved event loading, the registrant form, identity verification, and payment/seat hold into `src/hooks/`; `RegistrationPaymentPanel` moved to `src/components/RegistrationPaymentPanel.jsx` (409 lines) with its Square helpers. Step 5 moved the self-contained profile-edit flow (`needsProfileEdits`, start/cancel/save) into `src/hooks/useProfileEditing.js`. `RegisterPage.jsx` is 1151 lines (from 1949) with 8 `useState` calls (from 54). A vitest + Testing Library client runner (`npm run test:client`, `tests/client/`, in CI) covers all four stateful hooks with 65 tests. What remains in `RegisterPage()` is `handleSubmit` and its immediate state (`confirmation`, `formError`, `submitting`, `registrationFinalizing`, `closeMessage`) plus JSX - evaluated for extraction and deliberately left in place: `handleSubmit` reads from every other domain (registrant, identity, event, and payment state, ~17 distinct values) to actually submit the registration, so it is the page's legitimate orchestration point. Moving it into a hook would relocate that coupling into a parameter list rather than reduce it. EventForm, ConfigurationPanel, RegistrationPanel, UserControlPanel, and configurationService are untouched. |
| Centralize event display and registration availability logic | In Progress | Server-side capacity math lives in `api/_lib/registration-capacity.js`, shared by both `create-registration.js` call sites. Client registration eligibility and verification gates live in `src/utils/registrationEligibility.js`. Remaining: `src/utils/registrationAvailability.js` and `api/_lib/public-event-feed.js` still compute availability separately, and `isPaidEvent` is still defined in both the client util and `create-registration.js` because the client cannot import `api/_lib` (it pulls in `node:crypto`). A dependency-free `shared/` module would close that gap. |
| Add shared validation schemas | Not Started | Keep frontend, APIs, and Firestore data contracts aligned. |
| Add route-level lazy loading | Not Started | Reduce initial JavaScript and PWA precache size. |
| Add staging Firebase, Square sandbox, and test data | Not Started | Keep registration and payment testing out of production records. |
| Add error monitoring and operational alerts | Not Started | Capture client errors, API failures, payment mismatches, and email failures. |
| Consolidate Vercel APIs or move backend functions | Not Started | Currently at the Hobby 12-function limit; prefer extending existing routes before adding new ones. |
| Update project documentation to match the current system | Completed | Spec describes current behavior; this upgrade plan is the status source of truth; README covers setup, env, API surface, and production posture. |

## Completion Log

| Date | Change |
| --- | --- |
| 2026-07-22 | Created the upgrade plan and started Phase 1 registration security work. |
| 2026-07-22 | Completed Phase 1 code: protected profile lookup, Firebase/password verification, Resend email codes, one-use registration tokens, server-only registration creation, and removal of phone verification. |
| 2026-07-22 | Verified five registration-security tests, zero changed-file lint findings, a successful production build, Firestore rules compilation, and denial of an unauthenticated direct registration write. |
| 2026-07-22 | Added the `registrationVerifications.expiresAt` TTL policy to the version-controlled Firestore index configuration. |
| 2026-07-23 | Confirmed Phase 1 production testing passed and started Phase 2. Added 5-minute Square checkout seat reservations, private `registrationReservations` rules, and TTL cleanup for expired holds. |
| 2026-07-23 | Added registration idempotency protection using private `registrationAttempts` records and Square idempotency keys to guard against double-clicks and retry-created duplicate charges. |
| 2026-07-23 | Added Square webhook endpoint with signature verification, webhook event logging, payment completion/failure reconciliation, and full-refund-only registration refund updates. |
| 2026-07-23 | Added Payment Review dashboard module for Square webhook reconciliation records that need admin attention. |
| 2026-07-24 | Started app-initiated refund controls by adding a Payment Settings toggle while preserving the current treasurer-in-Square manual refund recording workflow. |
| 2026-07-24 | Added the guarded online Square refund action to the existing admin payment endpoint. When enabled, Square must return a completed refund before the registration is marked refunded/cancelled. |
| 2026-07-24 | Updated app-initiated refunds to handle Square PENDING responses without a second click. Refund Pending now cancels the registration immediately, returns the seat, and creates a Payment Review follow-up while Square completion remains pending. |
| 2026-07-24 | Added registration cancellation/refund notification emails after admin refund actions, using the existing email toggle and coordinator reply-to contact. |
| 2026-07-24 | Refined Square refund webhook reconciliation so refund-related `payment.updated` events no longer create Needs Review rows, and completed refund webhooks clear matching pending refund review items. |
| 2026-07-24 | Fixed member-directory reads by aligning the active-member query with Firestore rule constraints. |
| 2026-07-24 | Refreshed `PROJECT_SPEC.md` and this upgrade plan to match the current app configuration and upgrade status. |
| 2026-07-24 | Completed the final Phase 2 item by adding Firestore-backed rate limits for payment, registration, verification, and refund-sensitive API flows. |
| 2026-07-24 | Doc ownership pass: corrected API count to 12, marked Phase 3 rate limiting In Progress for remaining coverage/monitoring, pointed `PROJECT_SPEC.md` upgrade priorities at this plan, and documented `apiRateLimits`. |
| 2026-07-24 | README pass: expanded `.env.example`, added Firebase deploy command, API surface, and production posture aligned with this plan. |
| 2026-07-24 | Aligned GoDaddy Programs filter with Spec/app grouping by including Retreat (and legacy hyphenated class types); corrected Spec embed category/filter wording. |
| 2026-07-24 | Added directory-safe `memberDirectoryProfiles` collection, write-through sync, backfill script, and removed Active-member peer reads of full `users` documents. |
| 2026-07-24 | Phase 3 progress: extended API rate limits, security headers, privacy/support pages, event-admin Storage rules, server-only event writes via `/api/admin-manage-event`, and folded password changes into `/api/admin-update-user-profile`. |
| 2026-07-24 | Added admin Cancel Registration for free/unpaid registrations (`No Charge`, Pending, Waived, Failed) so seats can be returned without using the refund flow; updated Spec, App Overview, and Role Capabilities docs. |
| 2026-07-24 | Cleared the source lint backlog, scoped ESLint away from generated `.vercel` output, and added a GitHub Actions CI workflow running lint, build, and tests on Node 18 and 20. |
| 2026-07-24 | Extracted registration capacity and Square reconciliation logic into `api/_lib/`, shared one capacity predicate across both `create-registration.js` call sites, and added 19 tests (suite total 9 to 28). Verified the tests catch regressions by mutation testing the capacity boundary and the payment-hold email binding. |
| 2026-07-24 | Fixed a capacity/listing divergence: events saved with capacity 0 and unlimited unchecked advertised open seats on listings and the GoDaddy feed while registration silently waitlisted everyone. Capacity is now validated to at least 1 in `EventForm` and re-checked server-side in `/api/admin-manage-event`. Existing 0-capacity events still need a one-time cleanup. |
| 2026-07-24 | Added `npm run audit:zero-capacity` to list existing events stored with capacity 0 so they can be corrected. |
| 2026-07-24 | `RegisterPage` step 0: extracted registration eligibility and identity-verification gates to `src/utils/registrationEligibility.js` with 12 tests (suite total 28 to 40). Collapsed the duplicate `isPaidEvent`/`requiresBillingAddress` expressions. Mutation-tested the registrant-field identity gate and the paid-event rule. Behavior preserved; the file itself did not shrink, since the goal was testability ahead of the hook extraction. |
| 2026-07-24 | `RegisterPage` step 1: extracted event loading and membership-settings subscription into `src/hooks/useEventRegistration.js`. `RegisterPage.jsx` is 1910 lines, down from 1949. Verified live against the `vq-event-management` Firebase project (test data): the happy path (Test Half Day Class - $13 + $1 fee = $14 total, capacity 2) and the error path (nonexistent eventId - "Event Unavailable", no console errors) both render correctly through the extracted hook. Added `.claude/launch.json` so `npm run dev` can be previewed. No client test runner exists yet, so this step relied on manual verification rather than automated coverage. |
| 2026-07-24 | `RegisterPage` step 2: extracted the registrant contact/billing form (9 states, `applyProfile`, `reset`) into `src/hooks/useRegistrantForm.js`; JSX bindings were left untouched by aliasing the hook's returns to the original variable names. `RegisterPage.jsx` is 1902 lines. Fixed a real exhaustive-deps warning this surfaced: `setFieldErrors` is no longer a same-component `useState` setter so ESLint can no longer assume it is stable; added it to `runEmailLookup`'s dependency array rather than suppressing the warning. Discovered a testing-infrastructure limit: `npm run dev` cannot exercise anything past email lookup because it does not serve the `/api/*` Vercel functions (confirmed via a 404, handled gracefully by the existing error path, no console errors) - `vercel dev` would work but requires live Firebase/Resend secrets and would send real email, so it was not run without checking first. |
| 2026-07-25 | `RegisterPage` step 5: extracted the profile-edit flow (`needsProfileEdits` plus start/cancel/save) into `src/hooks/useProfileEditing.js`, including its own `validateProfileFields`. `RegisterPage.jsx` is 1151 lines with 8 `useState` calls. Considered and declined extracting `handleSubmit` itself into a "submission" hook: it reads ~17 distinct values across every other domain to build and send the registration request, so a hook wrapping it would need the same parameter count - relocating the coupling, not reducing it. Left it as the page's orchestration point, which is where cross-domain coordination belongs. Added 12 tests for `useProfileEditing` (suite 54 to 65), including format validation for state code, postal code, and phone, and that cancel does not call `applyProfile` when there is no matched profile. Mutation-tested the cancel-restore branch. Browser-verified the email field's onChange - which now calls the hook's exposed `setNeedsProfileEdits` alongside `handleEmailChange` - fires with no console errors. |
| 2026-07-25 | Ran `npm audit fix` (non-force): fixed `fast-uri`, `fast-xml-parser`, and `postcss` (25 findings to 22), lockfile-only. Reviewed the remaining 22 individually instead of forcing: `react-router`'s CSRF advisory only affects apps using its unstable RSC APIs (this app doesn't) and has no 7.x patch, so it's accepted as not applicable; the `brace-expansion`/`uuid` chains are pinned inside `firebase-admin@14.2.0` (already the latest published version) by Google's own SDK dependencies and are not reachable from any user-facing code path. |
| 2026-07-25 | Fixed a seat-hold race in `usePaymentReservation`. When a reservation request was already running, `ensurePaymentReservation` returned `null`, so a submit landing in that window posted an empty `paymentReservationId` and the server rejected it as an expired hold. Reachable in normal use: editing any billing field drops the hold and immediately starts a new one, so typing the last field and clicking Submit hits it. Concurrent callers now await the same in-flight promise and all receive the same reservation. Still exactly one hold per registrant. Mutation-tested: restoring the `null` return fails 2 tests. |
| 2026-07-24 | Moved `RegistrationPaymentPanel` and its Square helpers (`loadSquareScript`, `validateSquarePaymentConfig`, `buildSquarePaymentRequest`, `selectSandboxTestPayment`, and the module-level script-promise cache) out of `RegisterPage.jsx` into `src/components/RegistrationPaymentPanel.jsx`. `RegisterPage.jsx` is 1194 lines, down from 1600. Component behavior and props are unchanged; browser-verified the paid registration page still renders with correct cost math and no console errors. |
| 2026-07-24 | `RegisterPage` step 4 (final domain): extracted online payment and the seat hold into `src/hooks/usePaymentReservation.js` with 24 tests. `RegisterPage.jsx` is 1600 lines with 14 `useState` calls, down from 1949 and 54. The two capacity-protecting guards moved intact: the ref-based re-entrancy lock (without it, the auto-reserve effect and an explicit submit each create a hold, consuming two seats for one registrant) and the invalidation effect that drops a hold when identity, billing, event, or payment preference changes. Both are mutation-tested. Two ordering cycles were broken deliberately: `paymentPreference` stays in `RegisterPage` because `buildRegistrationRequest` needs it, and the lookup-time reservation reset reaches the hook through a ref since identity must be constructed first. Also moved `getEventPaymentTotal` into `registrationEligibility.js` so the page and hook share one definition. The new tests caught a real regression introduced during the extraction: the hook kept its own `paymentPreference` state while the page passed one in, so choosing cash/check later would still have taken a Square seat hold. |
| 2026-07-24 | `RegisterPage` step 3: extracted identity verification (email lookup, password sign-in, emailed-code fallback - 18 states and 4 async handlers) into `src/hooks/useIdentityVerification.js` with 22 tests. `RegisterPage.jsx` is 1747 lines and its `useState` count is down from 54 to 22. `runEmailLookup` also resets submission/payment-reservation state that belongs to `RegisterPage`, so rather than absorb unrelated state the hook takes `onBeforeLookup` and `setFormError` from the caller. Tests cover the security-relevant paths: the server's `verified` verdict overrides the caller's optimistic `alreadyVerified` hint, changing the email clears prior verification proof, and a failed code attempt clears the registration token. Mutation-tested both of those - each fails a test when broken. Browser-verified the no-API paths (event renders, invalid-email validation shows the error and issues no network request). |
| 2026-07-24 | Added a client test runner: vitest + `@testing-library/react` + `@testing-library/jest-dom`, config at `vitest.config.js`, tests under `tests/client/`, run via `npm run test:client` and wired into `.github/workflows/ci.yml` as a separate CI step alongside the existing `node --test` suite. Wrote 8 tests for `useRegistrantForm` (default state, `applyProfile` including the display-name-splitting fallback, `reset`, that `reset` intentionally leaves `fieldErrors` untouched, and that `applyProfile`/`reset` stay referentially stable across renders). Mutation-tested two of them: dropping the billing-country fallback and making `reset` also clear `fieldErrors` both fail a test. `npm audit` unchanged at 25 findings after adding the new dev dependencies. This closes the verification gap from the previous entry and unblocks the identity-verification and payment/seat-hold hook extractions. |
