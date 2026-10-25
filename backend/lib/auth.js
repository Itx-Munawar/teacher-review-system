// Admin authentication: JWT session tokens, the verifyAdmin middleware,
// password rules.

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const state = require('../state');
const { JWT_SECRET, BCRYPT_ROUNDS, ADMIN_SESSION_MINUTES, ADMIN_SESSION_MS } = require('../config');
const { parseCookies, buildCookieOptions } = require('./cookies');

// JWTs are stateless, so a stolen token would otherwise stay valid until it
// expires. admins.token_version is the revocation switch: it is baked into the
// token as `tv` and compared on every admin request, so bumping the column
// (password reset) invalidates every outstanding session at once. The check is
// skipped if the column is not present yet, so a failed migration can never
// lock the admin out of their own panel.

const signAdminToken = (admin) => jwt.sign(
    {
        id: admin.id,
        username: admin.username,
        tv: admin.token_version || admin.tv || 0
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: `${ADMIN_SESSION_MINUTES}m` }
);

// Sliding expiry: once a cookie session is past half of its lifetime, the next
// authenticated request re-issues it. Header-token clients manage their own
// token lifetime, so they are never given a cookie they did not ask for.
const refreshAdminSession = (req, res, decoded, cookieToken) => {
    if (!cookieToken || !decoded.exp) return;
    const remainingMs = decoded.exp * 1000 - Date.now();
    if (remainingMs > ADMIN_SESSION_MS / 2) return;
    res.cookie('admin_token', signAdminToken(decoded), buildCookieOptions(req));
};

const verifyAdmin = (req, res, next) => {
    const cookies = parseCookies(req);
    const headerToken = req.headers.authorization?.split(' ')[1];
    const cookieToken = headerToken ? null : cookies.admin_token;
    const token = headerToken || cookieToken;
    if (!token) return res.status(401).json({ error: 'No token provided' });

    let decoded;
    try {
        // Pinning the algorithm stops any "alg: none" / algorithm-confusion
        // forgery, and rejects a token signed for another purpose.
        decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (error) {
        return res.status(403).json({ error: 'Invalid token' });
    }

    if (!state.adminTokenVersionReady) {
        refreshAdminSession(req, res, decoded, cookieToken);
        req.admin = decoded;
        return next();
    }

    db.query('SELECT token_version FROM admins WHERE id = ?', [decoded.id])
        .then(([rows]) => {
            if (rows.length === 0 || rows[0].token_version !== (decoded.tv || 0)) {
                return res.status(403).json({ error: 'Session revoked' });
            }
            refreshAdminSession(req, res, decoded, cookieToken);
            req.admin = decoded;
            next();
        })
        .catch((error) => {
            // Fail closed: an unknown session state must not read as "admin".
            console.error('Admin session check failed:', error.message);
            res.status(500).json({ error: 'Session check failed' });
        });
};

// One password rule, used by both the reset flow and the bootstrap route so
// the two can never drift apart. Returns an error message or null.
const passwordProblem = (password) => {
    if (typeof password !== 'string' || password.length < 10) {
        return 'Password must be at least 10 characters';
    }
    // bcrypt reads at most 72 bytes and silently ignores the rest. Without this
    // cap, two different long passwords that share a prefix are interchangeable,
    // and a multi-byte character costs more than one of those bytes.
    if (Buffer.byteLength(password, 'utf8') > 72) {
        return 'Password must be at most 72 bytes (special characters count as more than one)';
    }
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
        return 'Password must include at least one letter and one number';
    }
    return null;
};

// Constant work per login attempt: comparing against a fixed dummy hash keeps
// "no such user" and "wrong password" indistinguishable by response timing.
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_ROUNDS);

// Quietly answer "is this caller already an admin?" without producing a
// response, so a route can require it as a second factor.
const hasAdminSession = async (req) => {
    const cookies = parseCookies(req);
    const headerToken = req.headers.authorization?.split(' ')[1];
    const token = headerToken || cookies.admin_token;
    if (!token) return false;
    let decoded;
    try {
        decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    } catch (error) {
        return false;
    }
    if (!state.adminTokenVersionReady) return true;
    try {
        const [rows] = await db.query('SELECT token_version FROM admins WHERE id = ?', [decoded.id]);
        return rows.length > 0 && rows[0].token_version === (decoded.tv || 0);
    } catch (error) {
        return false;
    }
};

module.exports = {
    signAdminToken,
    refreshAdminSession,
    verifyAdmin,
    passwordProblem,
    DUMMY_HASH,
    hasAdminSession
};
