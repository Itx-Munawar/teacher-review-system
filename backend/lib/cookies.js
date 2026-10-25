// Cookie parsing and admin session cookie options.

const { sameSiteFor } = require('../csrf');
const { ADMIN_SESSION_MS } = require('../config');

// ========== COOKIE HELPERS (no extra dependency) ==========
const parseCookies = (req) => {
    const cookies = {};
    const header = req.headers.cookie;
    if (!header) return cookies;
    header.split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        const key = part.slice(0, idx).trim();
        const raw = part.slice(idx + 1).trim();
        // A malformed %XX escape must not throw: that would turn one bad
        // cookie header into a 500 on every request.
        try {
            cookies[key] = decodeURIComponent(raw);
        } catch (err) {
            cookies[key] = raw;
        }
    });
    return cookies;
};

const buildCookieOptions = (req) => {
    // Derive the protocol from the actual request (trust proxy is enabled),
    // not from NODE_ENV, so HTTPS deployments always get a Secure cookie.
    // SameSite itself comes from the shared helper in csrf.js.
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    return {
        httpOnly: true,
        secure,
        sameSite: sameSiteFor(req, secure),
        maxAge: ADMIN_SESSION_MS,
        path: '/'
    };
};

module.exports = {
    parseCookies,
    buildCookieOptions
};
