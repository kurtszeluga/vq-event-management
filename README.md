# VQ Event Management

Event registration and payment management for Village Quilters programs and classes.

This project follows `PROJECT_SPEC.md` as the source of truth.

## Stack

- React + Vite
- React Router
- Progressive Web App
- Firebase Authentication and Firestore
- Google Drive Picker for event images and documents
- Vercel deployment
- Future Square-hosted Checkout payments

## Local Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy the environment template and fill in Firebase and Google web app values:

   ```sh
   cp .env.example .env.local
   ```

3. Run the development server:

   ```sh
   npm run dev
   ```

## Deployment Setup

### Firebase

Create or select a Firebase project for this app, enable Authentication and Firestore, then add a web app. Copy the web app config values into Vercel environment variables using the names in `.env.example`.

The repo includes:

- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`

Firebase Storage is not required for event assets.

### Google Drive

The admin event form can select image and PDF files from Google Drive. Configure a Google API key and OAuth client ID, then add these variables locally and in Vercel:

- `VITE_GOOGLE_API_KEY`
- `VITE_GOOGLE_CLIENT_ID`

Drive files selected for public events must be shared so visitors can view them.

### GitHub

The local branch is `main`. Add a GitHub remote named `origin`, push `main`, and connect that repository to Vercel.

### Vercel

Vercel should use:

- Build command: `npm run build`
- Output directory: `dist`
- Framework preset: Vite

`vercel.json` includes the SPA rewrite needed for React Router.

## Scripts

- `npm run dev` starts the local Vite server.
- `npm run build` creates a production build.
- `npm run preview` previews the production build.
- `npm run lint` runs ESLint.
- `npm run setup:first-admin` creates or updates the first Firebase Auth admin user and matching Firestore profile.

## First Admin Setup

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
