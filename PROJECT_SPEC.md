# VQ Event Management Project Spec

## Overview

VQ Event Management is a Progressive Web App for The Village Quilters Network. It manages Guild programs, workshops, challenges, retreats, registrations, member profiles, membership status, payments, confirmations, and selected member-only features.

The app is intended for two audiences:

- Members and registrants who need a simple way to view programs, register, pay, and review their registrations.
- Admins and coordinators who need compact operational tools with minimal training.

The public-facing listing feed can be embedded on the GoDaddy website, while registration, payment, profile, and admin workflows run through the Vercel-hosted app.

## Current Stack

- React, Vite, JavaScript, React Router
- Progressive Web App support
- Firebase Authentication
- Cloud Firestore
- Firebase Storage
- Firebase Admin SDK inside Vercel API routes
- Vercel deployment from GitHub
- Resend for transactional email
- Square Web Payments SDK and Square APIs for online card payment and app-initiated refunds

## Core Navigation

- Home/Admin Dashboard
- Programs & Activities
- My Registrations
- My Profile
- Member Directory
- Admin Dashboard modules for authorized users
- Login/Sign out

For admins, the dashboard is the primary home surface. It keeps the admin navigation row visible so users can jump between registrations, events/activities, workshops, challenges, business listings, for-sale listings, user controls, payment review, and system configuration.

`My Registrations` only appears in the nav once a member is signed in.

## Account Recovery

The login page's "Forgot password or username?" panel is a single field that accepts either an email address or a phone number - built for members with limited computer experience, so there is only ever one thing to fill in.

Flow:

- The member enters an email or phone number and submits.
- The server always returns the same generic response regardless of whether a match was found, to prevent account enumeration; a matching account is emailed a 6-digit code (hashed at rest, 10-minute nominal expiry, rate-limited by IP and by the entered identifier).
- Entering the correct code signs the member in for real - a Firebase custom token, hand-signed with `node:crypto` rather than the `firebase-admin/auth` SDK subpath (which breaks Vercel's function bundling in this project) - and redirects to `/profile` with the profile edit form already open and the password field focused.
- The member never sees their recovered email/username directly; proving control of the inbox and being signed in accomplishes the same goal without an extra reveal step.

This reuses the registration flow's email-verification-code pattern and its endpoint: the actions live inside the existing `api/registration-lookup.js` action router rather than a new file, to stay within the Vercel Hobby plan's function limit.

## Roles And Permissions

### Super User

- Full administrative access.
- Can manage users, roles, permissions, membership status, configuration, events, registrations, payments, refunds, and coordinator assignments.
- Super User profiles are excluded from membership checks and directory results.

### Admin

- Must have an active profile.
- Permission flags control access:
  - `manageEvents`
  - `viewRegistrations`
  - `managePayments`
  - `addUsers`
  - `manageMembershipStatus`
  - `registerOthers` — register a member on their behalf (cash/check only)
  - `manageWaitlist` — manually promote a Waitlisted registration off the waitlist, or pass an outstanding offer on to the next person
- Admin profile permissions are cleared when membership becomes inactive because inactive members cannot hold Guild positions.

### General User

- Can manage their own profile and login.
- Can register for eligible events.
- Can view their own registrations and payment history.
- Can view the member directory only when both profile status and membership status are Active and the directory is enabled.

## Profiles And Membership

The `users` collection is the source of truth for people, contact details, login identity, profile status, and Guild membership status.

Important behavior:

- A profile can exist without an activated login account.
- Firebase Authentication is attached when a person activates/signs into an account.
- Membership CSV upload updates profiles directly.
- The CSV importer scans for the real header row instead of assuming row 1, so a title/banner row above the column headers (a common roster-export shape) no longer causes every row to be silently dropped.
- CSV matching is email-first. Phone-only matches are treated cautiously and routed to exceptions/review rather than automatically applied.
- A CSV Town (or City) column, when present, is imported into the profile's `billingAddress.city`. On every import (Add/Update or Annual Refresh), a non-blank Town value syncs the profile's city; a blank cell leaves the existing value untouched.
- Selecting a CSV file only parses and previews it client-side - no writes happen yet. The preview reports total/valid row counts and flags rows with no name/email/phone (by row number) and duplicate emails within the file. Import only proceeds after an explicit confirmation step.
- Annual refresh assumes the CSV contains active paid Guild members.
- Annual refresh sets uploaded/new/reactivated profiles to Active membership and can set missing non-archived profiles to Inactive membership.
- Profiles created by CSV upload or by an admin assume terms were accepted manually/offline.
- Online membership signup/reactivation requires acceptance of terms and conditions.
- New online membership requests use `Pending` membership status until admin review.
- Membership payment tracking is stored on the profile and in `payments` history records.

Profile data includes:

- First name, last name, full name
- Email and phone
- Billing address
- Role and permission flags
- Profile status: Active, Inactive, Archived
- Membership status: Pending, Active, Inactive, Archived, Unknown
- Membership review/payment fields
- Terms acceptance fields

## Member Directory

The member directory is a member-only feature controlled by System Config.

Directory behavior:

- Only active profiles with Active membership can open the directory.
- The directory reads from `memberDirectoryProfiles`, a projection that contains only display-safe contact fields.
- Projection documents exist only for Active profiles with Active membership that are not Super Users.
- Directory settings control whether email, phone, city/state, and full address are shown in the UI.
- Directory has search and letter filters.
- Full `users` documents are not readable by directory peers; profile owners, Super Users, and permitted admins retain their existing user-document access.

## Event And Listing Types

Supported event/listing types:

- Class (Half Day)
- Class (Full Day)
- Workshop
- Lecture
- Retreat
- Challenges
- Business Listing
- For Sale
- Membership
- Other

Programs grouping:

- Class (Half Day)
- Class (Full Day)
- Lecture
- Retreat
- Other

Administrative cards are separated so business listings, for-sale listings, challenges, workshops, membership, and programs can be managed without crowding one event screen.

### Membership

A standing interim measure, not the membership module. The membership module is
not expected before 2028, so joining and renewing are handled as an event type
in the meantime: a member signs up and pays for membership exactly as they
register for a class, through the same registration and Square path.

What makes it different from every other type:

- **It appears in no list.** Not the Programs page, not the home page summary,
  not any GoDaddy feed category. It is reached only by the direct registration
  link, which an admin copies from the Membership module in the admin dashboard
  and posts by hand wherever they want it. `UNLISTED_EVENT_TYPES` in
  `src/data/eventOptions.js` is the list that governs this, and the copy-link
  control on the admin card is shown for exactly the types in it.
- **Its price depends on the day the member signs up**, not on a number typed
  into the event. Two rates and the day each starts live in Configuration >
  Payment Settings, and are copied onto the event when it is saved - so
  changing the guild's dues takes effect on an existing Membership event the
  next time that event is saved. The default is $25.00 from Jul 1 and $50.00
  from Oct 1. `shared/membershipDues.js` is the only thing that decides which
  rate applies; `getEventCostOn()` is what every price display and both
  server-side charge calculations call. A non-Membership event returns its
  stored `cost` from the same function, unchanged.
- **It has no seat limit**, so capacity is forced to unlimited, nobody is ever
  waitlisted, and the seat-hold countdown is suppressed on the registration
  form. The underlying reservation still happens: it is also what pins the
  amount Square is told to charge and makes the attempt idempotent.
- **Non-member registration is on by default**, because a new member is by
  definition not a member yet.
- **It runs over its listing window** rather than happening on a day, like a
  Challenge, so it collects no date, time, presenter or location.
- **It asks four extra questions**: type of phone (cell or home), new or
  renewing, veteran (yes or no), and an optional free-text box for skills the
  member is willing to share. Four fixed questions, not a question builder -
  see `shared/membershipQuestions.js` for why.
- **The signup page stands alone**: no site header, no navigation, no
  breadcrumbs. Only Terms and Privacy remain in the footer, kept deliberately
  because the page takes a card payment; Support is hidden. It ends on a
  terminal card - Close, then "Thank You" or "Signup Cancelled" - rather than
  navigating anywhere, so there is nothing to click and nowhere to go.
- **It has no account step.** Email, Submit, a 6-digit code, then the form.
  No profile lookup, no "Account Found", no password, and no offer to create
  one afterwards (`codeOnlyVerification` on `useIdentityVerification`). A
  returning member's details are still filled in, by `handleVerifyEmailCode`
  once the code is accepted rather than at lookup - which is the right order
  and also means the page never reveals whether an address has an account.
- **No admin can register anyone for it.** The register controls are hidden on
  both the event card and the Review/Edit Registrations card. The server has
  no card-entry path for admin-initiated registration, so the only record
  those controls could produce is a cash or cheque one against dues collected
  by card - a record that does not match the money. The signup link is the
  only way in.
- **Non-member registration is forced on and not offered as a choice**, since
  a signup for becoming a member cannot be restricted to members.

Those three - absence from every list, the chrome-less standalone page, and
the lack of any admin registration route - all read from `UNLISTED_EVENT_TYPES`
rather than from the type name, so they cannot drift apart.
- **It collects no location**, and the admin form locks the event type so it
  cannot be changed by accident: changing it on a live signup would strip the
  dues schedule and leave a flat-priced event.
- **Duplicate signups are refused** by the server's existing check: a second
  active registration for the same email and event returns a 409, and that
  path does not care about event type.
- **Its Google Sheet is four columns wider**, with the answers beside Phone.
  The standard eleven-column header is untouched for every other type, because
  everything to the right of the app's columns belongs to the coordinator and
  widening the shared header would shift every hand-added column on every
  existing sheet.

Paying does **not** change a profile's Membership Status. That stays a manual
act in User Controls, deliberately: there is no paid-through date on a profile
to expire, so an automatic flip to Active would never flip back.

Membership confirmations route to the **Membership** coordinator and the
Membership email instruction box. Both areas already existed, the coordinator
one declaring `coveredTypes: ['Membership']`, but `getEmailInstructionArea`
fell through to Programs for any unrecognised type - so until the type was
mapped, both were configurable and neither was reachable.

#### The listing dates are the signup link's on/off switch

`isEventVisible()` gates **registration** as well as listing, on the server as
well as in the browser. Membership appears in no list, so "List On Website" is
relabelled **"Open The Signup Link"** for this type - but the dates are not
decorative: past the Remove Listing date the link stops accepting signups, and
a Draft link does not work at all.

#### Two traps this type sets

**A requirement on a field the type does not render cannot be satisfied or
seen.** Membership shows no location, date, time, capacity or payment type.
Every one of those was still required by `validateEventForm`, so saving failed
with "Please fix the highlighted fields" and nothing was highlighted. The
`requires*` flags must agree with what the form renders for the type. The test
that protects this asserts the **whole** error object is empty for the form
the Membership module hands you; asserting individual keys is what let three
of these survive a first fix.

**A standalone signup ignores the signed-in session entirely.** No prefill, no
locked address, no auto-lookup - the guild account stays signed in on shared
machines, and on a public dues link that produced "this registration will be
for webmaster@villagequilters.com" with no way to correct it, plus a
verification code emailed on page load. Safe because authorization never
depended on it: `getMatchingUserIdToken` attaches a Firebase token only when
the signed-in address equals the one being registered.

**Card payment needs `web.squarecdn.com` in FOUR CSP directives** -
`script-src`, `style-src`, `connect-src`, `frame-src` - plus the sandbox host
for preview deploys. A gap in any one of them breaks the card form with
Square's catch-all "An unexpected error occurred while using Card", which
names neither CSP nor the blocked resource. `tests/csp-allows-square.test.js`
guards it; nothing else in the repo reads `vercel.json`.

**On every other event type the registration email box is locked to the
signed-in account**, and the server enforces it: `createRegistration` and `beginSquarePaymentReservation`
both reject a Firebase-authorized request whose email resolves to a different
profile. Signing up while signed in as another account therefore shows that
account's address, which reads as the form changing what was typed. The page
says so and offers a sign-out route. Making the box editable is not a
client-side change - it needs the request to drop Firebase authorization and
use email-code verification on both server paths.

## Event Configuration

Common event fields include:

- Title
- Event type
- Description
- Presenter/instructor where applicable
- Date
- Start and end time where applicable
- Location
- Capacity and unlimited-capacity option
- Paid/free flag
- Cost and service fee
- Registration open/close behavior
- Listing visibility dates
- Image uploads
- Supply/document uploads
- Coordinator/contact display
- Non-member registration allowed flag
- Cash/check later payment allowed flag

Type-specific behavior:

- Challenges do not use time. Start/end times default to `00:00` and time is hidden from challenge display cards.
- Challenges show challenge registration start/end dates in list views.
- Classes and workshops default registration close date/time to the class/workshop start when registration opens now.
- Lectures do not require registration configuration.
- Other supports a registration option of N/A for one-off events.
- Business Listings and For Sale do not use registration.

### Default Event Images

An event saved without an uploaded photo shows a default image instead of an empty thumbnail, on the admin list, the public listing cards, event details, and both print paths. Each event type maps to its own real, traditional quilt block pattern rendered as SVG (Nine Patch for classes, Churn Dash for workshops, Ohio Star for retreats, Flying Geese for lectures, Bear Paw for challenges, Pinwheel for everything else), each in its own color, with the event type name superimposed. Business Listing and For Sale intentionally have no default image. Assets live in `public/assets/event-placeholders/` and are regenerated with `scripts/generateEventPlaceholderImages.mjs`; the type-to-image mapping is `getEventPlaceholderImage()` in `src/data/eventOptions.js`. A real uploaded photo always takes priority.

## Public And GoDaddy Listings

The app supports GoDaddy embeddable listing feeds via `data-category`:

- `events` — programs, workshops, retreats, lectures, classes, and other non-listing activities
- `challenges` — challenge listings
- `business` — business listings
- `forsale` — for-sale listings

Current `events` feed behavior:

- Type filters show Programs and Workshops.
- The Programs filter includes Class (Half Day), Class (Full Day), Lecture, Retreat, and Other, matching the in-app Programs grouping.
- Cards are compact and include dates, payment details, capacity/registered/waitlisted/open-seat pills, coordinator contact, images, supply list links, and registration buttons when applicable.
- Register opens the Vercel registration flow.
- Supply list viewing/printing uses the working browser-compatible Vercel route behavior.

Challenges, business listings, and for-sale listings use their own embed category rather than appearing as filters on the `events` feed.

## Registration Flow

Registration is server-controlled. Clients cannot directly create Firestore registration documents.

Identity and eligibility:

- Signed-in users skip email entry when their account/profile is known.
- Existing profile lookup starts with email.
- Activated account users authenticate with Firebase password.
- Non-login/profile-only users verify identity through a Resend one-time email code.
- Verification codes are hashed, short-lived, and rate-limited.
- Successful verification issues a short-lived one-use registration token.
- Membership is checked before registration unless the event allows non-member registration or membership checks are disabled in config.
- Duplicate active registrations are detected before submit.
- For paid online registrations, a temporary seat hold is created before Square payment entry.

Capacity behavior:

- Online payment seat holds last 5 minutes.
- Active holds count against available capacity.
- When a hold expires, the user is returned to the listing and the seat becomes available.
- Waitlist messaging appears when no seat is available.
- Refund/cancellation returns the seat immediately.

Waitlist promotion:

- A seat frees up in two ways: a cancellation or refund, and an event's capacity being raised. Either way the earliest eligible Waitlisted registrant is automatically emailed an offer to claim it themselves through a magic-link claim page - no sign-in required, no auto-registration, no auto-charging.
- Raising capacity offers as many seats as were added, one per person down the waitlist; switching an event to unlimited capacity offers a seat to everyone waiting.
- A Waitlisted registration with an unexpired offer counts as seat-holding, which is how the offered seat stays reserved during the claim window without a separate reservation record.
- The claim window is 1 day. If it lapses unclaimed, a scheduled daily job advances the offer to the next person on that event's waitlist. The seat itself is released the moment the offer expires, not when the job runs - an expired offer stops counting as seat-holding - so the job only governs how soon the next person is told.
- The member can decline the offer from the claim page, which frees the seat immediately rather than leaving it idle for the rest of the window. Declining takes them off that event's waitlist; a waitlist belongs to one event, so turning down its seat is turning down the only thing being queued for.
- The event coordinator is emailed when a seat is offered (naming who was offered it, their contact details, and when the offer lapses, so they can chase the member directly), and again when a seat is claimed. Both share the `sendCoordinatorRegistrationNotifications` opt-in with the ordinary signup notification.
- If the waitlist is empty when a seat opens, the coordinator gets a one-time notification instead of an offer email. This is suppressed on the capacity-increase path, where it would otherwise fire every time the loop runs out of people to offer.
- Admins with the `manageWaitlist` permission can manually promote a Waitlisted registration directly from the Registrations panel, bypassing the offer/claim flow entirely, and can record a decline on the member's behalf with Pass To Next - the same operation as the member declining, offered only while an offer is actually outstanding.
- Both admin screens word their register controls as a waitlist once an event is full and registration is still open: Join Waitlist and Waitlist A Member.

Registration records include:

- Event snapshot fields such as event title, type, date, cost, service fee, and amount due
- Registrant name, email, phone
- Profile/user linkage where available
- Membership/profile status at registration
- Payment preference, method, status, amount paid, Square transaction/refund IDs
- Registration status: Pending Payment, Registered, Cancelled, Waitlisted
- Waitlist offer fields when applicable: offered/expires timestamps, a hashed claim token, and a claimed-date once resolved

## My Registrations

Signed-in users can view their registrations.

Current behavior:

- Default sort is event date, newest first.
- Details slide open inline.
- Details include event info, registration date/time, registration history for repeated test/cancel registrations, payment info, and payment history.
- Users can print their registration details.

## Payments

The app uses embedded Square payment through the Square Web Payments SDK.

Payment modes:

- Free event: `No Charge`
- Online card payment: Square
- Cash/check later: allowed only when the admin enables it on the event
- Manual cash/check payment: admin-recorded
- Waived/comped payment: admin-recorded with $0 paid

Payment settings in System Config:

- Default service fee
- Enable/disable card payments
- Enable Apple Pay toggle
- Enable Google Pay toggle
- Allow app-initiated Square refunds toggle

Card/wallet payment note:

- The Village Quilters Network does not store card numbers, security codes, or wallet payment details. Square handles payment information.

Refund and cancellation behavior:

- Paid online registrations are locked except for refund.
- When app-initiated refunds are enabled, admins can process Square refunds from the registration edit card.
- If Square returns `COMPLETED`, registration becomes Cancelled and payment becomes Refunded.
- If Square returns `PENDING`, registration is still cancelled immediately, the seat is returned, and a Payment Review follow-up is created.
- Square webhook completion updates/refines payment/refund records and clears matching pending refund review items.
- If app-initiated refunds are disabled, the treasurer can process refunds in Square and admins can record the result manually.
- Free (`No Charge`) and other unpaid active registrations can be cancelled directly from the registration edit card without a refund. Cancellation returns the seat immediately and keeps the existing payment status.
- Refund and free-registration cancellation both send a cancellation status email to the registrant when confirmation emails are enabled.

## Payment Review

Payment Review tracks Square webhook events that need attention.

Current behavior:

- Signed Square webhook endpoint records Square events.
- Completed payment and refund events are reconciled automatically when matched.
- Refund-related `payment.updated` webhooks are logged as No Action so they do not create false review items.
- Needs Review rows can be manually marked reviewed with notes.
- Dashboard displays a Payment Review count for items needing attention.

## Email

Resend is used for transactional email.

Current email features:

- Registration verification code
- Registration confirmation
- Waitlist/pending payment messaging through the registration confirmation template
- Membership signup/reactivation confirmation
- Refund/cancellation notification
- System Config test email by selected area

Email configuration:

- Global Send registration confirmations toggle
- Area-specific instruction text:
  - Programs
  - Workshops
  - Challenges
  - Membership
- Emails use the Guild logo and The Village Quilters display name.
- Reply-To uses the coordinator email for the selected area when available.

## Coordinator Assignments

System Config allows Super Users to assign area coordinators.

Coordinator areas:

- Programs: Class (Half Day), Class (Full Day), Lecture, Retreat
- Workshops
- Challenges
- Business Listings
- For Sale
- Membership

Each assignment stores:

- Assigned user/profile
- Assigned name/email from the profile
- Optional contact email override
- Active flag

Listings and emails use "For questions contact:" with the coordinator name/email.

## System Configuration

System Config currently includes:

- Membership checks, terms text, terms version, and CSV import
- Payment settings
- Directory settings
- Email instructions and test email
- Default event locations
- Default event times
- Coordinator assignments

## Data Collections

Primary collections:

- `users`: profiles, roles, membership, billing address, terms, membership payment tracking
- `events`: programs, workshops, challenges, business listings, for-sale listings, and other activities
- `registrations`: server-created registration records
- `payments`: payment and refund history for registrations and memberships
- `auditLogs`: read-only audit history
- `appSettings`: membership, payment, directory, email, and other configuration documents
- `coordinatorAssignments`: area coordinator records
- `eventLocationDefaults`: reusable location defaults
- `eventTimeDefaults`: reusable time defaults
- `registrationVerifications`: private hashed email-code verification records with TTL
- `registrationReservations`: private temporary online-payment seat holds with TTL
- `registrationAttempts`: private idempotency records
- `apiRateLimits`: private Firestore-backed API rate-limit counters with TTL
- `memberDirectoryProfiles`: directory-safe member contact projections synced from eligible `users` profiles
- `squareWebhookEvents`: Square webhook logs and payment review records

Legacy/transition:

- `members` is fully unused - confirmed zero live callers of its read/write functions (`subscribeToMembers`, `saveMember`, `archiveMember`, `reactivateMember` in `configurationService.js`) anywhere in `src/`. Membership is managed entirely on `users`. The collection is a candidate for deletion.

## Security Requirements

- Firestore rules enforce role, permission, profile, directory, and membership constraints.
- Registration creation is server-only.
- Sensitive payment/refund, membership admin updates, event writes, and password changes are handled through authenticated server endpoints.
- Event create/update/delete is server-only; clients cannot write the `events` collection directly.
- Verification, reservation, attempt, and rate-limit collections are not client-readable.
- Member directory readers use `memberDirectoryProfiles` only; they cannot read peer `users` documents.
- Audit logs are create-only/read-only for authorized admins.
- Firebase, Square, and Resend secrets must remain in environment variables.
- Vercel Hobby function count should be watched; prefer extending existing API routes over adding new functions.
- Production responses include CSP, frame protection, referrer policy, content-type protection, and permissions policy.
- Account recovery and waitlist claim links use hashed, expiring, single-purpose tokens (email/phone recovery codes; waitlist claim tokens); the recovery sign-in itself uses a Firebase custom token hand-signed with `node:crypto` rather than the `firebase-admin/auth` SDK.
- The waitlist-expiry scheduled job is a `GET` endpoint gated by comparing the request's bearer token against the `CRON_SECRET` environment variable, matching Vercel's own cron-auth convention.
- `memberDirectoryProfiles` writes must never be batched atomically with the `users` write that made the profile newly directory-eligible (a brand-new active member, or a reactivation). The rule's eligibility check reads `users/{id}` with `get()`, which only sees the database as it stood before the current commit, so a same-batch profile write and directory write are refused together. Client code (`configurationService.js`, `userService.js`) always commits the profile write first, then syncs the directory entry as a separate write. Bulk directory syncs (CSV import) also need a much smaller batch chunk size than plain profile writes - each directory write costs several `get()`/`exists()` calls against the same document, uncached, and Firestore evaluates both the create and update branches of the rule for every `set()`; 200 per batch exceeds Firestore's per-request rule-evaluation budget, 5 is verified safe. See `tests/rules/member-directory-batch-create.test.js`.

## Current Upgrade Priorities

Track completed work, remaining items, and phase status in `PROJECT_UPGRADE.md`. This spec describes current system behavior only; do not duplicate status tables here.

Near-term focus: finish remaining server-side membership/config writes, abuse monitoring/alerts, CI/tests, and operational tooling. See the upgrade plan for authoritative status.

## Long-Term Vision

The app is expected to grow into the primary Village Quilters member portal, including:

- Membership management and renewal
- Member-only information
- Member directory print/export
- Event registration and payment
- Attendance and roster tools
- Coordinator workflows
- Operational and financial reports
- Reminders and calendar integration
- Better support for non-technical Guild administrators
