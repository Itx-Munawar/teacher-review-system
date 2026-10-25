// Service worker registration for PWA offline support.
// Only enabled in production builds (dev server serves live assets).
export function registerServiceWorker() {
    if (!import.meta.env.PROD) {
        return;
    }
    if (!('serviceWorker' in navigator)) {
        return;
    }
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).then((registration) => {
            console.log('✅ Service worker registered:', registration.scope);
        }).catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    });
}
