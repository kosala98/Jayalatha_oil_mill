import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt': never reload the app under the cashier mid-sale. We show a banner instead.
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'පොල් තෙල් මෝල — POS',
        short_name: 'මෝල POS',
        description: 'Coconut oil mill point of sale',
        lang: 'si',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#EDF0E8',
        theme_color: '#2B2119',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // App shell + bundled fonts precached so the counter opens with no signal.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Product catalog: fresh when online, cached copy when not. Works cross-origin (CORS).
            // Same-origin in dev (/api/products), /functions/v1/api/products on Supabase.
            urlPattern: ({ url }) => url.pathname.endsWith('/api/products'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-products',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    // Local dev without CORS: /api → the edge function under `supabase functions serve`.
    // /api/sales is forwarded to <target>/api/sales, which is how Supabase names it.
    proxy: { '/api': 'http://127.0.0.1:54321/functions/v1' },
  },
});
