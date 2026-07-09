# VQ Event Management

Event registration and payment management for Village Quilters programs and classes.

This project follows `PROJECT_SPEC.md` as the source of truth.

## Stack

- React + Vite
- React Router
- Progressive Web App
- Firebase Authentication, Firestore, and future Storage
- Vercel deployment
- Future Square-hosted Checkout payments

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

Create or select a Firebase project for this app, enable Authentication and Firestore, then add a web app. Copy the web app config values into Vercel environment variables using the names in `.env.example`.

The repo includes:

- `firebase.json`
- `firestore.rules`
- `firestore.indexes.json`
- `storage.rules`

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
