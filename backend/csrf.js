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
        cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return cookies;
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
            sameSite: secure ? 'none' : 'lax',
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

    // Use constant-time comparison to prevent timing attacks
    if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
        return res.status(403).json({ error: 'CSRF token mismatch' });
    }

    next();
}

module.exports = { csrfSetCookie, csrfValidate, CSRF_COOKIE_NAME, CSRF_HEADER_NAME };
