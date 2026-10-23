const crypto = require('crypto');

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const TOKEN_LENGTH = 32;
const COOKIE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Generate a cryptographically secure random token.
 */
function generateToken() {
    return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * Parse a raw cookie header into a { name: value } map.
 */
function parseCookies(header) {
    const cookies = {};
    if (!header) return cookies;
    header.split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        const key = part.slice(0, idx).trim();
        const raw = part.slice(idx + 1).trim();
        // A stray % in a cookie value must not throw: this runs on every
        // state-changing request, so one bad header would become a 500.
        try {
            cookies[key] = decodeURIComponent(raw);
        } catch (err) {
            cookies[key] = raw;
        }
    });
    return cookies;
}

/**
 * SameSite is a site-level decision (scheme + registrable domain, ports are
 * ignored), never an origin-level one. Anything running same-origin against
 * /api - the Vercel rewrite in production, the CRA proxy in dev - can use
 * "lax", which browsers refuse to send on cross-site writes. A genuinely
 * cross-site API needs the weaker "none", but only when the cookie is Secure,
 * because "None" without Secure is rejected outright.
 *
 * Both the CSRF cookie and the admin session cookie go through this so they
 * can never disagree with each other.
 */
function registrableSite(hostHeader) {
    const hostname = String(hostHeader || '')
        .split(',')[0]
        .trim()
        .toLowerCase()
        .replace(/:\d+$/, '');
    if (!hostname) return '';
    const labels = hostname.split('.');
    return labels.length > 2 ? labels.slice(-2).join('.') : hostname;
}

function sameSiteFor(req, secure) {
    if (!secure) return 'lax';

    let originSite = '';
    if (req.headers.origin) {
        try {
            originSite = registrableSite(new URL(req.headers.origin).hostname);
        } catch (err) {
            originSite = '';
        }
    }
    // No Origin header = same-origin GET, health check or non-browser client.
    // "lax" is the stricter and therefore safer default.
    if (!originSite) return 'lax';

    const requestSite = registrableSite(req.headers['x-forwarded-host'] || req.headers.host);
    if (requestSite && originSite === requestSite) return 'lax';
    return 'none';
}

/**
 * Middleware 1: Set the CSRF cookie on every response.
 * Call this early in the middleware chain so the cookie is always present.
 */
function csrfSetCookie(req, res, next) {
    // Only set if not already present (avoids overwriting on every request)
    const existing = parseCookies(req.headers.cookie)[CSRF_COOKIE_NAME];
    if (!existing) {
        const token = generateToken();
        const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.cookie(CSRF_COOKIE_NAME, token, {
            httpOnly: false,       // JavaScript must be able to read this
            secure,
            sameSite: sameSiteFor(req, secure),
            maxAge: COOKIE_MAX_AGE,
            path: '/'
        });
    }
    next();
}

/**
 * Middleware 2: Validate the CSRF token on state-changing requests.
 *
 * The client must:
 *   1. Read the `csrf_token` cookie value with document.cookie
 *   2. Send it as the `X-CSRF-Token` header on every POST / PUT / DELETE / PATCH request
 *
 * This is the "Double Submit Cookie" pattern:
 *   - An attacker can trigger the browser to *send* the cookie automatically,
 *     but cannot *read* it (same-origin policy), so they cannot set the header.
 *   - The header presence + cookie match proves the request came from our own origin.
 */
function csrfValidate(req, res, next) {
    // Skip safe methods (GET, HEAD, OPTIONS) — they don't mutate state
    const safeMethods = ['GET', 'HEAD', 'OPTIONS'];
    if (safeMethods.includes(req.method)) {
        return next();
    }

    const cookieToken = parseCookies(req.headers.cookie)[CSRF_COOKIE_NAME];
    const headerToken = req.headers[CSRF_HEADER_NAME];

    if (!cookieToken || !headerToken) {
        return res.status(403).json({ error: 'CSRF token missing' });
    }

    // Lengths must match first: crypto.timingSafeEqual throws a RangeError on
    // unequal buffers, which would turn a forged header into a 500 instead of
    // the 403 the attacker should get.
    if (Buffer.byteLength(cookieToken, 'utf8') !== Buffer.byteLength(headerToken, 'utf8')) {
        return res.status(403).json({ error: 'CSRF token mismatch' });
    }

    // Use constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
        return res.status(403).json({ error: 'CSRF token mismatch' });
    }

    next();
}

module.exports = { csrfSetCookie, csrfValidate, sameSiteFor, CSRF_COOKIE_NAME, CSRF_HEADER_NAME };
