import { defineConfig } from 'vitest/config';
import { VitePWA } from 'vite-plugin-pwa';

// BASE_PATH is set by the GitHub Pages workflow (e.g. /repo-name/).
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
    base,
    // Fixed port keeps the localhost origin (and thus IndexedDB data) stable.
    server: { port: 5173, strictPort: true },
    preview: { port: 5173, strictPort: true },
    worker: { format: 'es' },
    plugins: [
        VitePWA({
            registerType: 'autoUpdate',
            includeAssets: ['apple-touch-icon.png'],
            workbox: {
                // The ONNX runtime WASM is ~27 MB, so it is cached on first use instead of precached.
                globIgnores: ['**/*.wasm'],
                maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
                runtimeCaching: [
                    {
                        urlPattern: /\.wasm$/,
                        handler: 'CacheFirst',
                        options: { cacheName: 'onnx-wasm', cacheableResponse: { statuses: [0, 200] } },
                    },
                    {
                        urlPattern: /^https:\/\/cdn\.jsdelivr\.net\//,
                        handler: 'CacheFirst',
                        options: { cacheName: 'onnx-runtime', cacheableResponse: { statuses: [0, 200] } },
                    },
                ],
            },
            manifest: {
                name: 'Pronunciation Practice',
                short_name: 'Pronounce',
                description: 'Import real voice recordings, then practice and compare your pronunciation',
                lang: 'en',
                display: 'standalone',
                orientation: 'any',
                background_color: '#fffaf0',
                theme_color: '#ff8a3d',
                start_url: base,
                scope: base,
                icons: [
                    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
                    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
            },
        }),
    ],
    test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
