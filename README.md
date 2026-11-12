# VQ Event Management

Progressive Web App for The Village Quilters Network. The app manages programs, workshops, challenges, registrations, member profiles, membership status, payment tracking, confirmation emails, coordinator contacts, and member-only features.

Primary docs:

- `PROJECT_SPEC.md` describes the current application configuration and operating model.
- `PROJECT_UPGRADE.md` tracks completed upgrade work and remaining priorities (status source of truth).
- `APP_OVERVIEW.md` provides a plain-language summary of the app and its major features.
- `ROLE_CAPABILITIES_OVERVIEW.md` summarizes what visitors, members, admins, super users, and coordinators can do.

## Current Production Posture

- Production data was reset to just the Super User account for beta testing with a small group of invited Guild members. The site footer shows a build version tag (`src/version.js`, starting at Beta 1.0) bumped by hand for each significant change.
- Phase 1 registration security and Phase 2 payment/capacity reliability are complete.
- Directory-safe projections, broader API rate limits, security headers, privacy/support pages, and server-only event writes are in place.
- Remaining Phase 3 work is mainly membership CSV/config write centralization and abuse monitoring/alerts.
- The Vercel Hobby plan is at the **12** serverless function limit; prefer extending existing API routes over adding new ones.

See `PROJECT_UPGRADE.md` for authoritative status.

## Stack

- React + Vite
- React Router
- Progressive Web App
- Firebase Authentication, Firestore, and Storage
- Firebase Admin SDK in Vercel API routes
- Resend transactional email
- Square Web Payments SDK and Square APIs
- GitHub to Vercel deployment

## Local Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy the environment template and fill in Firebase web app values:

   ```sh
   cp .env.example .env.local
   ```

3. Run the development server:

   ```sh
   npm run dev
   ```

Node 20+ is recommended. `npm test` runs a focused Node test suite and does not require Firebase emulators.

## Deployment Setup

### Firebase

Create or select a Firebase project for this app, enable Authentication (Email/Password), Firestore, and Storage, then add a web app. Copy the web app config values into `.env.local` and Vercel using the `VITE_FIREBASE_*` names in `.env.example`.

The repo includes:

- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`

Event images and supply-list PDFs upload to Firebase Storage from the admin event form.

After changing rules or indexes, publish with:

```sh
firebase deploy --only firestore:rules,firestore:indexes,storage
```

### Event Files

Event images should be JPG, PNG, or WebP. The app resizes images to a maximum of 1600 x 1200 pixels and compresses them to 1 MB or less before upload. Supply lists must be PDF files no larger than 10 MB.

### Payments And Email

Online card payments use embedded Square payment fields. The app does not store card numbers, security codes, or wallet payment details.

Vercel production needs these server-side values when payments, webhooks, and emails are enabled (also listed in `.env.example`):

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SQUARE_ACCESS_TOKEN`
- `SQUARE_APPLICATION_ID`
- `SQUARE_LOCATION_ID`
- `SQUARE_ENVIRONMENT` (`sandbox` or `production`)
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SQUARE_WEBHOOK_NOTIFICATION_URL` (typically `https://<your-vercel-domain>/api/square-webhook`)
- `CRON_SECRET` — any random string; authorizes the daily waitlist-offer-expiry job (see Scheduled Jobs below)

Optional:

- `APP_ORIGIN` — public site origin for email links
- `DISABLE_API_RATE_LIMITS` — set `true` only for local/testing bypass
- `FIREBASE_API_KEY` — fallback for some admin API routes
- `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` — separate key for the Google Sheet sync (see below)

### Registration Google Sheets

Every event with registration enabled can get its own Google Sheet in a Shared
Drive folder, created when the event is saved and rewritten whenever someone
registers, cancels, or has a payment recorded. Off until it is set up.

Setup, once:

1. **Pick the service account.** The Firebase one (`FIREBASE_SERVICE_ACCOUNT_JSON`)
   works and needs nothing new. To keep the key that can reach the guild's Drive
   separate from the one that mints Firebase tokens, create a second service
   account and set `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` instead.
2. **Enable both APIs** on that service account's Google Cloud project: Google
   Drive API and Google Sheets API.
3. **Share the folder.** Create a folder in a Shared Drive, then share it with
   the service account's `client_email` (it is in the JSON key) as **Content
   manager**. A Shared Drive is required — a folder in someone's personal My
   Drive cannot hold files a service account creates, because a service account
   has no storage quota of its own.
4. **Deploy the Firestore rules.** Easy to miss, and the symptom is a flat
   "Missing or insufficient permissions" when you try to save in step 5 — a
   Vercel deploy ships the app but never touches `firestore.rules`. This feature
   adds the `appSettings/registrationSheets` write branch and the
   `eventRegistrationSheets` read rule; without them the setting cannot be
   saved and the sheet link never appears on the registration list.

   ```
   npx firebase deploy --only firestore:rules --project <the project THIS deployment uses>
   ```

   **Name the project explicitly.** `.firebaserc` defaults to
   `vq-event-management`, so a bare `firebase deploy` goes to that project
   whichever environment you meant. Each Firebase project needs its own rules
   deploy, its own APIs enabled, and its own service account added to the Drive
   folder — the client project is baked into the bundle at build time, so check
   which one the deployment actually uses rather than assuming.
5. **Switch it on** in the app: Admin → **Setup / System Config** → **Google
   Sheets** (Super User only). Tick the box and paste the folder's address from
   Drive; the folder ID is picked out of it on save.

Notes:

- The sheet is a mirror, rewritten in full from the registrations on every
  change, so it is self-healing — a sync that failed catches up on the next
  change to the event.
- **Coordinators can add rows by hand** for people who registered at the door.
  Leave the **Registration ID** cell empty: that blank is how the sync tells
  your row from one it wrote, and rows with a blank ID are read back and kept
  on every rewrite (re-appended below the synced ones). A row with something
  typed into Registration ID is treated as the app's and will be overwritten.
  If the sync cannot read the sheet, it abandons the update rather than
  clearing anything, so a hand-typed row is never lost to a failed read.
- Rows run **newest first**, so an event that is filling up shows today's
  sign-ups at the top. Hand-entered rows sit together below the synced ones.
- Editing a *synced* row is pointless — the next rewrite restores it from the
  registration, which is the source of truth. That includes the Notes column,
  which carries the payment note.
- **Your own columns to the right of Registration ID are kept, and follow their
  registrant.** Add a "Called?" or "Brought food?" column and the sync carries
  each cell with the registration it sits beside, matched on Registration ID
  rather than on row position — so a new sign-up pushing rows down no longer
  leaves your notes describing the wrong person. Your column headings in row 1
  are kept too, and a formula stays a formula. Notes on a hand-entered row
  travel with that row. A note whose registration has been deleted goes with
  it, rather than attaching itself to whoever lands on that row.
- **Your notes live only in the sheet.** They are read out of it and written
  back on every sync; nothing in the app stores them. So deleting a row by hand
  deletes the note in it permanently — rebuilding restores the registration
  from Firestore, but there is no copy of the note to restore. Column headings
  in row 1 survive as long as row 1 does.
- A walk-in who later registers online will appear twice, once as your row and
  once as theirs. Delete your row when that happens.
- Cancelled and waitlisted registrants stay in the sheet with their status, so a
  row never silently disappears.
- A sync failure never blocks a registration. The reason is recorded and shown
  on the registration list page.
- **Nobody needs to press anything.** The registration list only offers a
  button when one would actually do something, because a permanent "Update
  Sheet" button read as an instruction to press it after every registration.
  The states are:

  | What the page shows | What it means |
  | --- | --- |
  | A grey box: "Last synced 2 minutes ago with 4 registrations. **Update now** if you have changed the sheet yourself" | Nothing known to be wrong. It reports when the sync ran and how many rows it wrote — never that the sheet is "up to date", which is a claim about a file this page has not read. |
  | A **popup**, then an amber box: "The sheet has been changed by hand since it was last synced" | Somebody has been in the spreadsheet since the sync wrote it. Detected by comparing Drive's `modifiedTime` against the recorded sync — one API call, and the only check that can see a row deleted by hand. |
  | **Create Sheet**, in an amber notice box, no popup | The event has no sheet — it was set up before the feature was switched on, so nothing has happened to trigger one. Every such event is in this state, so a popup would fire on all of them. |
  | A **popup**, then **Update Sheet** in an amber notice box, with "Last synced with 1 registration; there are now 2" | The recorded row count disagrees with the registrations on screen, so a sync did not run when it should have. |
  | A **popup**, then **Retry** in a red error box, with the Google error | The last sync failed. (Unreadable settings give the red box but no popup — as likely a passing hiccup as a real problem.) |
  | Nothing at all | The feature is switched off in Configuration. |
  The popup appears once per visit, only where the sheet is **known** to
  disagree with the app, and never when everything is current — a popup that
  fires when nothing is wrong teaches people to dismiss popups unread.

  Hand edits **are** detected, but through Drive rather than the row counts: the
  recorded row count is what the last sync *wrote*, so deleting a row by hand
  leaves the app's own records agreeing with each other. The page therefore
  asks the server once per view whether the file has been modified since the
  recorded sync. If that check is unavailable the page says only when it last
  synced and how many rows it wrote, and the **Update now** link is always
  there to rebuild the grid regardless.
- Turning the setting off stops the syncing and leaves the existing sheets
  exactly as they are. The registration list then says nothing about sheets.

### Scheduled Jobs

`vercel.json` declares one Vercel Cron job (`0 13 * * *`, once daily — the Hobby plan's maximum frequency) that hits `/api/create-registration` via `GET` to advance any unclaimed waitlist offers to the next person. Vercel picks this up automatically on deploy; the only setup needed is setting `CRON_SECRET` above, which the cron request must present as a bearer token. Without it, the cron call is refused and unclaimed offers simply never advance until it's set.

Use Square sandbox credentials while testing and production credentials only when ready to take live payments.

### GitHub

The local branch is `main`. Add a GitHub remote named `origin`, push `main`, and connect that repository to Vercel.

### Vercel

Vercel should use:

- Build command: `npm run build`
- Output directory: `dist`
- Framework preset: Vite

`vercel.json` includes the SPA rewrite needed for React Router.

Set both the `VITE_FIREBASE_*` client variables and the server variables above in the Vercel project environment. The Hobby plan has a 12-function limit, so prefer extending existing API routes before adding new functions.


#### When something happens to the sheet

| What happened | What the sync does |
| --- | --- |
| Sheet deleted, or in the bin | Creates a replacement in the folder and relinks. Registrations are rebuilt in full; **hand-entered rows and your own columns are lost with the file.** Only logged, not surfaced in the app — the link quietly points at a new, shorter sheet. If the original is later restored from the bin you will have two files, and the app writes to the newer one. |
| The **tab** renamed (`Registrations` → `Sign-ups`) | Fine. The live tab title is read on every sync, so writes follow the rename. |
| The **Drive file** renamed | Renamed back on the next sync, to match the event's title and date. Harmless, but a name you chose will not stick. |
| Moved to another folder | Fine. The sheet is found by ID, never by location. |
| **The folder setting changed** | Only affects sheets created *after* it. An event that already has a sheet keeps writing to that sheet wherever it lives, because the sync finds it by its stored ID — so repointing the setting does **not** re-home existing sheets. To move one, drag it into the new folder in Drive and the sync follows it, keeping its rows, walk-ins and your own columns. Trashing it instead makes the next sync build a fresh one in the new folder, losing anything that lived only in the sheet. |
| Service account loses access | The sync aborts, records why, and shows it on the registration list page. Deliberately does **not** create a replacement — a 403 means someone un-shared it, which is worth seeing rather than papering over with a duplicate. Only a 404 triggers a recreate. |
| A second tab added, and dragged to first position | Fine. The tab is found by the `sheetId` recorded when the sheet was created, never by position, so your own tabs can sit anywhere in any order. |
| The Registrations **tab** deleted | A replacement tab is added and the rows rebuilt from Firestore. It does **not** adopt whichever tab is now first — that tab is yours. Anything you had typed into the deleted tab went with it. |

#### Archived and deleted events

Archiving **leaves the sheet and its link completely alone** — the archive
branch returns before the sync runs, so the final attendee list is preserved as
it stood. To get back to it: switch the Registrations (or Events) status filter
to **Archived**, drill into the event, and *Print Registration List* still
carries the Open Google Sheet link. A sync still works on an archived event, so
if its sheet is behind the page offers the button as it would for any other
event — and because archiving only requires that no payments are awaiting
collection, later corrections to its registrations still reach the sheet.

One permission wrinkle: `firestore.rules` allows any reader to load an event
while it is `Published`, but an `Archived` one needs `manageEvents`. The
registration list page only requires `viewRegistrations`. So a coordinator
holding `viewRegistrations` alone can open the sheet for a live event but not
for an archived one — the page fails loading the event first. Super Users and
admins with `manageEvents` are unaffected. (Pre-existing rule, not introduced by
this feature, but it decides who keeps in-app access after archiving.)

Deleting an event removes the event document and leaves the link document
orphaned. The spreadsheet itself survives in Drive, which is right — it is the
record — but every route to it in the app goes through the event, so you would
find it in the folder by name.

## API Surface

Top-level Vercel routes under `api/` (12):

- `admin-create-user`
- `admin-manage-event`
- `admin-update-registration-payment`
- `admin-update-user-profile`
- `create-registration`
- `file-proxy`
- `godaddy-event-feed`
- `godaddy-supply-list-viewer`
- `public-events`
- `public-registration-counts`
- `registration-lookup`
- `square-webhook`

Shared helpers live under `api/_lib/` and do not count as separate functions. Registration creates and Square webhook handling are server-only.

## GoDaddy Embed

`public/godaddy-event-feed.js` is a dependency-free IIFE that renders the public listings inside a GoDaddy HTML block. It has no build step and cannot import from `shared/`, so the feed API serializes anything it needs into the payload rather than the script re-implementing it.

Paste a mount div and the script tag:

```html
<div data-vq-feed data-category="programs" data-layout="grid"></div>
<script src="https://events.villagequilters.com/godaddy-event-feed.js" defer></script>
```

| Attribute | Purpose |
| --- | --- |
| `data-vq-feed` | Marks the mount. Required. |
| `data-category` | Which listings load: `programs`, `workshops`, `challenges`, `business`, `forsale`. `events` is a legacy alias resolving to `programs`. On its own it only sets which pill starts selected. |
| `data-categories` | Comma-separated list controlling which pills appear and in what order. A single value hides the pill row, which is how a page is pinned to one kind of listing. |
| `data-template` | `summary` switches the mount from cards to summary rows — one line per event with the date, the event type and the title, nothing else. Built for the home page; see below. Anything else falls back to the normal per-type cards. |
| `data-layout` | Card geometry: `roster` (default), `grid`, `agenda`. Does not apply to `data-template="summary"`, which brings its own. |
| `data-layout-switcher` | Adds a layout row readers can switch with. Presence alone offers all three; a comma-separated list (`"grid,roster"`) narrows it to those, in that order. `false`/`0`/`off`/`no` turns it back off, and fewer than two renders nothing. A `data-layout` the list does not offer falls back to its first entry, so no page starts with every pill unpressed. |
| `data-empty-message` | Replaces the default empty-state text. Also covers a pill filtering everything out, not just a page with nothing on it. |
| `data-limit` | Caps how many cards render, for a teaser strip. The limit slices the fetched list **before** the Programs/Workshops filter runs in the browser, so a limit on that page can show fewer cards than asked for, or none. |
| `data-source-url` | Overrides the API host. Normally omitted: the feed calls `/api/public-events` on whichever host served the script, so the script tag is the only URL on a page. |

Card content is chosen by listing type, independently of layout: events show seats and cost, For Sale leads with the asking price, and Business Listings render as a contact block.

### The home page summary

`data-template="summary"` is the one mount that is not a per-type card page. It needs no other attributes:

```html
<div data-vq-feed data-template="summary"
     data-empty-message="No events are scheduled right now - check back soon."></div>
```

It loads its own feed category, `allevents` — **every published event, Challenges included, in date order with Challenges last**. That is a different set from any pill: `programs` excludes Challenges, because each type has its own page, while the summary is the one place a reader sees all of them together. Business Listings and For Sale stay out; they are directory entries, not events.

Three behaviours are deliberate and worth not "fixing":

- **No date cutoff.** The summary lists what is published, and an event leaves it by being archived — which the feed query's `status == 'Published'` filter already handles. Past events therefore remain until someone archives them.
- **Challenges last.** `requiresDate` in `EventForm.jsx` is `requiresSchedule && !isChallenge`, so a Challenge legitimately has no date, and Firestore sorts an empty date before every real one. Without this they would lead the page as a row of "Date TBD" above the next actual event.
- **The rows are not links.** Readers reach an event through the site's own navigation, so there is no anchor, no chevron and no hover state. `detailUrl` is still in the feed payload; the summary just does not use it.

`summary` is not a `data-layout` value and is not in the pill list, both on purpose: layouts are a CSS class swap with no re-render, so a Summary layout button would swap the class and leave the cards in place; and the pill list doubles as the fallback for a mount with no `data-categories`, so adding it there would grow a pill on every existing embed. `tests/godaddy-feed-summary.test.js` pins both.

The rows run in two columns once the mount is at least 700px wide, one column below that, and `data-limit` and `data-empty-message` both still apply.

`events.villagequilters.com` is production. `test.villagequilters.com` serves test listings and sends registrants to the Square sandbox. Never use the raw `*.vercel.app` deployment URL in an embed — it serves production with no warning and changes between deploys.

Six live mounts as of 2026-11-09: Programs & Classes, Workshops, Guild Challenges, Business Listings and For Sale each carry a per-type card page, and the home page carries the summary. All six load the script from `events.villagequilters.com`.

`public/godaddy-event-feed-demo.html` renders the feed with the layout switcher enabled, shows the summary alongside it, and carries a full setup reference in an HTML comment.

## Scripts

- `npm run dev` starts the local Vite server.
- `npm run build` creates a production build.
- `npm run preview` previews the production build.
- `npm run lint` runs ESLint.
- `npm test` runs the focused Node test suite (`tests/*.test.js`).
- `npm run setup:first-admin` creates or updates the first Firebase Auth Super User and matching Firestore profile.
- `npm run backfill:member-directory` rebuilds `memberDirectoryProfiles` from eligible `users` docs (requires `FIREBASE_SERVICE_ACCOUNT_PATH`).
- `npm run backfill:registrant-names` builds `eventRegistrantNames` for events that already had registrations when the member-visible list shipped (requires `FIREBASE_SERVICE_ACCOUNT_PATH`). Dry run unless `--commit`; the app maintains these documents from each registration change onwards, so this is only needed once per project.
- `npm run copy:events` copies event documents from one Firebase project's `events` collection into another's — normally Production into `vq-event-management-test`, so listings entered once for real can be reused as test data. See below.

### Copying events between projects

Production and test are separate Firebase projects sharing no data, so this script is the only route between them. It needs a service account for each side and is a **dry run unless `--commit` is passed**:

```bash
SOURCE_SERVICE_ACCOUNT_PATH=~/prod-sa.json \
TARGET_SERVICE_ACCOUNT_PATH=~/test-sa.json \
npm run copy:events
```

| Flag | Effect |
| --- | --- |
| `--commit` | Actually write. Without it the script reports what it would do and touches nothing. |
| `--overwrite` | Replace events already in the target. Default is to skip them, so a re-run only adds what is new. |
| `--type="For Sale"` | Copy a single event type. Repeatable. |
| `--limit=10` | Stop after this many source events. |

Document IDs are preserved, which makes re-runs idempotent and keeps `/events/{id}` links matching on both sides. The script refuses to run if both service accounts resolve to the same project.

Two limits worth knowing. Photos and PDFs are **referenced, not copied** — Firebase Storage download URLs are absolute, so a copied event renders its images but serves them from the source project's bucket; deleting those files on the source breaks the copy. And only the `events` collection is copied: registrations, payments, and users carry real people's data and are not test fixtures.
- `node scripts/generateEventPlaceholderImages.mjs` regenerates the default per-event-type images shown when an event has no uploaded photo (`public/assets/event-placeholders/`).

## First Super User Setup

Enable the Email/Password provider in Firebase Authentication, create a Firebase service account key, then run:

```sh
FIREBASE_SERVICE_ACCOUNT_PATH=/path/to/service-account.json \
FIRST_ADMIN_EMAIL=admin@example.com \
FIRST_ADMIN_PASSWORD='replace-with-a-strong-password' \
FIRST_ADMIN_NAME='Admin Name' \
FIRST_ADMIN_PHONE='555-0101' \
npm run setup:first-admin
```

Do not commit the service account key.

The setup script grants the first profile the `Super User` role with all admin permissions. Run this before deploying user-permission Firestore rules.
