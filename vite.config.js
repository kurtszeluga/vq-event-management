import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
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
        navigateFallbackDenylist: [/^\/api\//]
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
