// Service worker registration for PWA offline support.
// Only enabled in production builds (dev server serves live assets).
export function registerServiceWorker() {
    if (process.env.NODE_ENV !== 'production') {
        return;
    }
    if (!('serviceWorker' in navigator)) {
        return;
    }
    window.addEventListener('load', () => {
        navigator.serviceWorker.register(`${process.env.PUBLIC_URL}/sw.js`).then((registration) => {
            console.log('✅ Service worker registered:', registration.scope);
        }).catch((error) => {
            console.warn('Service worker registration failed:', error);
        });
    });
}
