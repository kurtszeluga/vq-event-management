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
| `data-layout` | Card geometry: `roster` (default), `grid`, `agenda`. |
| `data-layout-switcher` | Adds a Roster/Grid/Agenda row for comparing layouts on a live page. Presence alone enables it. |
| `data-empty-message` | Replaces the default empty-state text. Also covers a pill filtering everything out, not just a page with nothing on it. |
| `data-limit` | Caps how many cards render, for a teaser strip. The limit slices the fetched list **before** the Programs/Workshops filter runs in the browser, so a limit on that page can show fewer cards than asked for, or none. |
| `data-source-url` | Overrides the API host. Normally omitted: the feed calls `/api/public-events` on whichever host served the script, so the script tag is the only URL on a page. |

Card content is chosen by listing type, independently of layout: events show seats and cost, For Sale leads with the asking price, and Business Listings render as a contact block.

`events.villagequilters.com` is production. `test.villagequilters.com` serves test listings and sends registrants to the Square sandbox. Never use the raw `*.vercel.app` deployment URL in an embed — it serves production with no warning and changes between deploys.

`public/godaddy-event-feed-demo.html` renders the feed with the layout switcher enabled and carries a full setup reference in an HTML comment.

## Scripts

- `npm run dev` starts the local Vite server.
- `npm run build` creates a production build.
- `npm run preview` previews the production build.
- `npm run lint` runs ESLint.
- `npm test` runs the focused Node test suite (`tests/*.test.js`).
- `npm run setup:first-admin` creates or updates the first Firebase Auth Super User and matching Firestore profile.
- `npm run backfill:member-directory` rebuilds `memberDirectoryProfiles` from eligible `users` docs (requires `FIREBASE_SERVICE_ACCOUNT_PATH`).
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
