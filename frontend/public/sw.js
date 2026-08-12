/* UMT Teacher Reviews - Service Worker
   - Caches the app shell (index.html + static assets) for offline use
   - Serves the shell from cache as a fallback so previously visited pages work offline
   - Never caches API responses (always network) to keep review data fresh
*/

const CACHE_NAME = 'umt-reviews-v1';
const SHELL_CACHE = 'umt-reviews-shell-v1';

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
    const url = new URL(request.url);

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

    // Static assets: cache-first, then network
    if (request.destination === 'script' || request.destination === 'style' || request.destination === 'image' || request.destination === 'font') {
        event.respondWith(
            caches.match(request).then((cached) => {
                const networkFetch = fetch(request).then((response) => {
                    if (response && response.ok && url.origin === self.location.origin) {
                        const copy = response.clone();
                        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
                    }
                    return response;
                }).catch(() => cached);
                return cached || networkFetch;
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
