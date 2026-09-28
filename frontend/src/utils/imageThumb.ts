/**
 * Teacher photos are hotlinked from UMT's servers at full resolution — typically
 * 300x300 up to 472x591, weighing 18 KB to 230 KB — but are displayed in
 * 36px–130px circles. Resizing them on the fly to a small WebP cuts each photo
 * to roughly 1.5 KB, which is by far the biggest win on slow mobile connections.
 *
 * Only hosts we know about are rewritten, so this never turns into an open
 * image proxy, and any failure falls back to the untouched original URL.
 */
const THUMBNAIL_PROXY = 'https://wsrv.nl/';

/** Hosts whose images we are willing to route through the resize proxy. */
const PROXY_HOSTS = new Set(['admin.umt.edu.pk', 'www.umt.edu.pk', 'umt.edu.pk']);

/**
 * True when the value looks like a real, fetchable image file.
 * Rejects blank values and bare directory URLs such as
 * `https://admin.umt.edu.pk/Media/UserProfile/` (no filename), which the
 * database contains a few of and which would otherwise render as a broken image.
 */
export function isUsableImageUrl(url?: string | null): boolean {
    const trimmed = (url || '').trim();
    if (!/^https?:\/\//i.test(trimmed)) return false;
    try {
        const { hostname, pathname } = new URL(trimmed);
        if (!hostname) return false;
        const filename = pathname.split('/').filter(Boolean).pop() || '';
        return /\.(jpe?g|png|webp|gif|avif)$/i.test(filename);
    } catch {
        return false;
    }
}

/**
 * Returns a resized, cover-cropped, WebP version of `url` at the given pixel
 * width, or the URL unchanged when it can't (or shouldn't) be proxied.
 */
export function thumbUrl(url: string, width: number): string {
    const trimmed = (url || '').trim();
    if (!isUsableImageUrl(trimmed)) return trimmed;
    try {
        if (!PROXY_HOSTS.has(new URL(trimmed).hostname.toLowerCase())) return trimmed;
    } catch {
        return trimmed;
    }

    const params = new URLSearchParams({
        url: trimmed,
        w: String(width),
        h: String(width),
        fit: 'cover',
        output: 'webp',
        q: '72',
    });
    return `${THUMBNAIL_PROXY}?${params}`;
}

/** 1x/2x source set so the circle stays sharp on high-DPI phones for ~2 KB. */
export function thumbSrcSet(url: string, width: number): string | undefined {
    const oneX = thumbUrl(url, width);
    if (oneX === (url || '').trim()) return undefined; // not proxied
    return `${oneX} 1x, ${thumbUrl(url, width * 2)} 2x`;
}
