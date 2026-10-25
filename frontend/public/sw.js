/* UMT Teacher Reviews - Service Worker
   - Caches the app shell (index.html + static assets) for offline use
   - Serves the shell from cache as a fallback so previously visited pages work offline
   - Never caches API responses (always network) to keep review data fresh
   - Leaves cross-origin requests (teacher photo thumbnails on wsrv.nl, Google Fonts) to the
     browser: this worker can't cache them (opaque responses), so intercepting them only
     added a hop and a second code path in front of every photo.
*/

const CACHE_NAME = 'umt-reviews-v3';
const SHELL_CACHE = 'umt-reviews-shell-v3';

const SHELL_URLS = [
    '/',
    '/index.html',
    '/manifest.json',
    '/logo192.png',
    '/logo512.png',
    '/favicon.ico'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)).then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter((key) => key !== CACHE_NAME && key !== SHELL_CACHE).map((key) => caches.delete(key))
            )
        ).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);

    // Cross-origin (photo thumbnails, fonts): straight to the browser and its HTTP cache
    if (url.origin !== self.location.origin) return;

    // Always use network for API calls (never cache fresh review data)
    if (url.pathname.startsWith('/api/')) {
        return;
    }

    // HTML navigations: network-first, fall back to cached shell when offline
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(SHELL_CACHE).then((cache) => cache.put('/index.html', copy));
                    return response;
                })
                .catch(() => caches.match('/index.html').then((cached) => cached || caches.match('/')))
        );
        return;
    }

    // Same-origin static assets
    if (request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font') {
        // Vite build output under /assets/ has a content hash in its name, so a cached copy is
        // never stale: serve it without touching the network (the old code fired a network
        // request for every cached asset anyway, wasting bandwidth on slow connections).
        const isHashed = url.pathname.startsWith('/assets/');

        event.respondWith(
            caches.match(request).then((cached) => {
                const refresh = () => fetch(request).then((response) => {
                    if (response && response.ok) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                });

                if (cached) {
                    // Unhashed files (logos, manifest) are refreshed quietly for next time
                    if (!isHashed) event.waitUntil(refresh().catch(() => {}));
                    return cached;
                }
                return refresh();
            })
        );
        return;
    }
});

// Pre-cache the current page's assets on first load
self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'CACHE_URLS') {
        const urls = event.data.urls;
        if (Array.isArray(urls)) {
            caches.open(CACHE_NAME).then((cache) => cache.addAll(urls)).catch(() => {});
        }
    }
});
