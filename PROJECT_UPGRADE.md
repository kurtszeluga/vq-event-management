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
| Remove the obsolete public phone-verification endpoint | Completed | Removed the endpoint and client calls, reducing the Vercel API count to 11. |
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
| Initiate Square refunds from the app | Not Started | Do not mark an online payment refunded until Square confirms it. |
| Add payment and card-testing rate limits | Not Started | Include bot protection such as Cloudflare Turnstile or Firebase App Check. |
| Enforce idempotency across registration retries | Completed | Registration submit attempts now carry a stable browser-generated attempt key, store a private `registrationAttempts` record, reuse existing results on retry, and send the same key to Square to avoid duplicate charges. |

## Phase 3 - Data Security And Permissions

| Item | Status | Notes |
| --- | --- | --- |
| Create a directory-safe member collection | Not Started | Do not expose complete user documents to directory users. |
| Correct and test member-directory Firestore queries | Not Started | Query constraints must match all rule conditions. |
| Restrict event file uploads to authorized event administrators | Not Started | Current Storage rules allow any signed-in user to upload to their own folder. |
| Route sensitive writes through authenticated server endpoints | Not Started | Covers events, membership changes, permissions, payments, and authoritative audit records. |
| Add API rate limiting and abuse monitoring | Not Started | Protect lookup, verification, registration, email, and file-proxy endpoints. |
| Add production security headers | Not Started | Add CSP, frame protection, referrer policy, content-type protection, and permissions policy. |
| Add a privacy policy and support/contact page | Not Started | Particularly important for directory, billing, registration, and payment data. |

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
| Add automated Firestore rules and workflow tests | Not Started | Prioritize registration eligibility, membership, capacity, payments, imports, and permissions. |
| Add continuous integration for build, lint, and tests | Not Started | Prevent broken deployments from reaching production. |
| Fix current source lint errors and ignore generated `.vercel` files | Not Started | The July 2026 review found 15 source errors and 3 warnings. |
| Resolve dependency audit findings | Not Started | Review one high and six moderate findings without forcing breaking downgrades. |
| Split oversized components and services | Not Started | RegisterPage, EventForm, ConfigurationPanel, RegistrationPanel, UserControlPanel, and configurationService need smaller ownership boundaries. |
| Centralize event display and registration availability logic | Not Started | Eliminate drift between app listings, GoDaddy feed, details, print, and email. |
| Add shared validation schemas | Not Started | Keep frontend, APIs, and Firestore data contracts aligned. |
| Add route-level lazy loading | Not Started | Reduce initial JavaScript and PWA precache size. |
| Add staging Firebase, Square sandbox, and test data | Not Started | Keep registration and payment testing out of production records. |
| Add error monitoring and operational alerts | Not Started | Capture client errors, API failures, payment mismatches, and email failures. |
| Consolidate Vercel APIs or move backend functions | Not Started | The Hobby plan was at the 12-function limit during the review. |
| Update README and PROJECT_SPEC to match the current system | Not Started | Current documentation still describes Square-hosted checkout and several older workflows. |

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
