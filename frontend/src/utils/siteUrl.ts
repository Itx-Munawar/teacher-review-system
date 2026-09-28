/**
 * Canonical base URL for SEO tags (canonical link, Open Graph, JSON-LD).
 *
 * Prefers REACT_APP_SITE_URL so a custom domain can be pinned at build time,
 * and otherwise falls back to the origin the app is actually served from —
 * no hardcoded deployment URL to go stale.
 */
export const SITE_URL = (
    (process.env.REACT_APP_SITE_URL as string | undefined)?.trim() ||
    (typeof window !== 'undefined' ? window.location.origin : '')
).replace(/\/+$/, '');
