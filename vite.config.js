import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// The commit this bundle was built from, stamped into the footer as
// "Build: <sha>".
//
// It replaced a hand-maintained version string that read "Beta 1.1" for 195
// commits, which is worse than no version at all: it was not wrong in a way
// anyone could notice. Nothing here needs maintaining, and it cannot go
// stale.
//
// Vercel sets VERCEL_GIT_COMMIT_SHA for every build; `git` is the local
// fallback, and a build with neither (a tarball, a container with no .git)
// simply gets no stamp rather than a wrong one.
function resolveCommitSha() {
  const fromVercel = String(process.env.VERCEL_GIT_COMMIT_SHA || '').trim();

  if (fromVercel) {
    return fromVercel.slice(0, 7);
  }

  try {
    return execSync('git rev-parse --short=7 HEAD', {
      stdio: ['ignore', 'pipe', 'ignore']
    }).toString().trim();
  } catch {
    return '';
  }
}

export default defineConfig({
  // Replaced at build time. src/version.js reads it through a `typeof` guard,
  // so the client tests - which run under vitest.config.js and get no define
  // - see an undeclared identifier rather than a crash.
  define: {
    __APP_COMMIT_SHA__: JSON.stringify(resolveCommitSha())
  },
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore', 'firebase/storage'],
          router: ['react-router-dom']
        }
      }
    }
  },
  plugins: [
    react(),
    VitePWA({
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallbackDenylist: [/^\/api\//]
      , skipWaiting: true,
        clientsClaim: true
      },
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'The Village Quilters Network',
        short_name: 'VQ Network',
        description:
          'Managing events, activities and members for The Village Quilters.',
        theme_color: '#225c56',
        background_color: '#f7f3ef',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          },
          {
            src: '/pwa-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ]
});
