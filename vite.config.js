import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt', not 'autoUpdate': the auto-deploy hook ships many builds, and a
      // surprise mid-session reload would lose in-progress edits. A waiting SW
      // surfaces the "Update ready" pill instead (see src/lib/pwa.js).
      registerType: 'prompt',
      // We register the SW manually from src/lib/pwa.js (called only in PROD).
      injectRegister: false,
      // Keep the hand-written public/manifest.json — do NOT let the plugin
      // generate or inject one (index.html already links /manifest.json).
      manifest: false,
      // No service worker in dev — keeps `npm run dev` SW-free.
      devOptions: { enabled: false },
      workbox: {
        // Precache the built app shell. woff/woff2 included in case fonts ever
        // ship locally (today they load from the Google Fonts CDN at runtime).
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        // Precache the largest JS chunk (recharts + react) so the shell is
        // fully available offline; default 2 MiB can drop big vendor bundles.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        // SPA fallback: client-routed paths serve index.html. Anything with a
        // file extension (assets, /manifest.json, icons) is excluded so it 404s
        // rather than being handed the app HTML.
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/\.[^/?]+$/],
        // ONLY Google Fonts are runtime-cached. Everything else — supabase.co,
        // api.anthropic.com, *.googleapis.com (Fit/Calendar), google.com OAuth —
        // is unmatched, so Workbox never handles it: it passes straight to the
        // network and is NEVER cached. Do not add API hosts here.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-stylesheets',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'google-fonts-webfonts',
              expiration: { maxEntries: 30, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
})
