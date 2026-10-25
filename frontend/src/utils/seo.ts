/**
 * Small SEO helper for a client-rendered app.
 *
 * Every route used to inherit the homepage canonical from `index.html`, which
 * told search engines to index `/` instead of `/questions`, `/privacy`, and the
 * other pages that are listed in the sitemap. `applySeo` updates the tags that
 * are already in `index.html` (and creates them if a route is opened directly).
 */

export interface SeoOptions {
    title: string;
    description: string;
    /** Absolute canonical URL for this route. */
    url: string;
    /** Ask crawlers to keep this route out of the index (admin, soft 404s). */
    noindex?: boolean;
}

function setMeta(selector: string, content: string): void {
    const el = document.head.querySelector(selector);
    if (el) el.setAttribute('content', content);
}

export function applySeo({ title, description, url, noindex = false }: SeoOptions): void {
    document.title = title;

    setMeta('meta[name="description"]', description);
    setMeta('meta[property="og:title"]', title);
    setMeta('meta[property="og:description"]', description);
    setMeta('meta[property="og:url"]', url);
    setMeta('meta[name="twitter:title"]', title);
    setMeta('meta[name="twitter:description"]', description);

    let canonical = document.head.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
    if (!canonical) {
        canonical = document.createElement('link');
        canonical.rel = 'canonical';
        document.head.appendChild(canonical);
    }
    canonical.href = url;

    let robots = document.head.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!robots) {
        robots = document.createElement('meta');
        robots.name = 'robots';
        document.head.appendChild(robots);
    }
    robots.content = noindex ? 'noindex, nofollow' : 'index, follow';
}
