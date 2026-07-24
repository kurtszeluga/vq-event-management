# VQ Event Management

Progressive Web App for The Village Quilters Network. The app manages programs, workshops, challenges, registrations, member profiles, membership status, payment tracking, confirmation emails, coordinator contacts, and member-only features.

Primary docs:

- `PROJECT_SPEC.md` describes the current application configuration and operating model.
- `PROJECT_UPGRADE.md` tracks completed upgrade work and remaining priorities.
- `APP_OVERVIEW.md` provides a plain-language summary of the app and its major features.
- `ROLE_CAPABILITIES_OVERVIEW.md` summarizes what visitors, members, admins, super users, and coordinators can do.

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

## Deployment Setup

### Firebase

Create or select a Firebase project for this app, enable Authentication, Firestore, and Storage, then add a web app. Copy the web app config values into Vercel environment variables using the names in `.env.example`.

The repo includes:

- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`

Event images and supply-list PDFs upload to Firebase Storage from the admin event form.

Publish Firestore rules and indexes after changes to:

- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`

### Event Files

Event images should be JPG, PNG, or WebP. The app resizes images to a maximum of 1600 x 1200 pixels and compresses them to 1 MB or less before upload. Supply lists must be PDF files no larger than 10 MB.

### Payments And Email

Online card payments use embedded Square payment fields. The app does not store card numbers, security codes, or wallet payment details.

Vercel production needs these server-side values when payments, webhooks, and emails are enabled:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `SQUARE_ACCESS_TOKEN`
- `SQUARE_APPLICATION_ID`
- `SQUARE_LOCATION_ID`
- `SQUARE_ENVIRONMENT`
- `SQUARE_WEBHOOK_SIGNATURE_KEY`
- `SQUARE_WEBHOOK_NOTIFICATION_URL`

Use Square sandbox credentials while testing and production credentials only when ready to take live payments.

### GitHub

The local branch is `main`. Add a GitHub remote named `origin`, push `main`, and connect that repository to Vercel.

### Vercel

Vercel should use:

- Build command: `npm run build`
- Output directory: `dist`
- Framework preset: Vite

`vercel.json` includes the SPA rewrite needed for React Router.

The Vercel Hobby plan has a serverless function limit, so prefer extending existing API routes before adding new functions.

## Scripts

- `npm run dev` starts the local Vite server.
- `npm run build` creates a production build.
- `npm run preview` previews the production build.
- `npm run lint` runs ESLint.
- `npm test` runs the focused Node test suite.
- `npm run setup:first-admin` creates or updates the first Firebase Auth Super User and matching Firestore profile.

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
