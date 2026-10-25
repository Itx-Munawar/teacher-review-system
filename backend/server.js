require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./db');
// sameSiteFor is shared with the CSRF cookie so both cookies always agree.
const { csrfSetCookie, csrfValidate, sameSiteFor } = require('./csrf');
const { detectFlaggedText, moderationFlagFor, sweepExistingReviews, sweepExistingQa } = require('./contentFilter');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
// Cost 12 is 4x the work of 10 and still only a couple of hundred ms, which is
// what keeps a stolen hash expensive to crack. Clamped so a typo in the env
// cannot silently weaken it, and existing cost-10 hashes still verify because
// bcrypt stores the cost inside the hash itself.
const BCRYPT_ROUNDS = Math.min(15, Math.max(10, parseInt(process.env.BCRYPT_ROUNDS, 10) || 12));
// Sliding admin session: every authenticated request moves the expiry forward,
// so 30 idle minutes ends the session server-side as well as in the UI (the
// client timer alone left a stolen cookie usable for the full JWT lifetime).
const ADMIN_SESSION_MINUTES = Math.min(24 * 60, Math.max(5, parseInt(process.env.ADMIN_SESSION_MINUTES, 10) || 30));
const ADMIN_SESSION_MS = ADMIN_SESSION_MINUTES * 60 * 1000;
// Public site origin used in sitemap.xml / robots.txt. FRONTEND_URL is already
// required at startup, so there is no reason to bake a deployment hostname in.
const PUBLIC_SITE_URL = String(process.env.FRONTEND_URL || 'https://teacher-review-system-zeta.vercel.app').replace(/\/+$/, '');

// ========== ENV VALIDATION ==========
const missingVars = [];
if (!JWT_SECRET) missingVars.push('JWT_SECRET');
if (!process.env.FRONTEND_URL) missingVars.push('FRONTEND_URL');
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) missingVars.push('DB_*');
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) missingVars.push('EMAIL_USER/EMAIL_PASS');
if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Server will not start. Fix the environment configuration and retry.');
    process.exit(1);
}

// An HS256 token is only as strong as its key. A short secret can be
// brute-forced offline from one leaked admin cookie, so require the RFC 7518
// minimum instead of starting with a key that only looks configured.
if (JWT_SECRET.length < 32) {
    console.error('❌ JWT_SECRET must be at least 32 characters. Generate one with:');
    console.error('   node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
    process.exit(1);
}

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

// Security Middleware
app.set('trust proxy', 1);
app.use(helmet());

// Exact origins that may send the admin cookie. Configurable so a new
// deployment does not need a code change; the defaults cover prod + dev.
const allowedOrigins = new Set(
    (process.env.CORS_ALLOWED_ORIGINS || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .concat([
            'https://teacher-review-system-zeta.vercel.app',
            // The configured frontend origin (e.g. http://localhost:3000 in
            // dev) instead of hardcoding localhost into every deployment.
            ...(() => {
                try {
                    return [new URL(process.env.FRONTEND_URL).origin];
                } catch (error) {
                    return [];
                }
            })()
        ])
);

// Ephemeral preview origins (monkeycode/deploy previews) may read PUBLIC data
// only. They get CORS without Allow-Credentials, so a page on someone else's
// preview host can never read an admin-authenticated response - previously
// every *.monkeycode-ai.live subdomain had credentialed access to /api/admin.
const previewOrigin = (origin) => /^https:\/\/[\w-]+\.(monkeycode-ai\.live|vercel\.app)$/.test(origin);

const credentialedCors = cors({ origin: true, credentials: true });
const publicCors = cors({ origin: true, credentials: false });

app.use((req, res, next) => {
    const origin = req.headers.origin;
    // No Origin header: curl/health checks/server-to-server. CORS does not
    // apply, so we deliberately add no headers (and no Vary churn).
    if (!origin || origin === 'null') return next();
    if (allowedOrigins.has(origin)) return credentialedCors(req, res, next);
    if (previewOrigin(origin)) return publicCors(req, res, next);
    // Unlisted origin: no CORS headers -> browser blocks the response.
    return next();
});

// Public payloads are tiny (a review is <=1000 chars). The old 10mb limit
// turned every request into a cheap memory-exhaustion vector.
app.use(express.json({ limit: '100kb' }));

// CSRF: set cookie on every response so the frontend can read it
app.use(csrfSetCookie);

// ========== STRUCTURED LOGGING ==========
// One JSON object per line, so Render's log drains can be parsed and searched
// (Render's console "search" is text-only, but a downloaded log or a drain to
// a log service can filter on msg/level/status). Plain console.* stays for
// errors because stack traces read better multiline.
const logJson = (level, msg, fields = {}) => {
    const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields });
    if (level === 'error') console.error(line);
    else console.log(line);
};

// Skip the endpoints a monitor hits every few minutes; logging them would be
// the only thing in the log on a quiet day.
const UNLOGGED_PATHS = new Set(['/api/health', '/api/ready']);
app.use((req, res, next) => {
    if (UNLOGGED_PATHS.has(req.path)) return next();
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        // res.getHeader is safe here: 'finish' fires after the response is sent.
        logJson('info', 'http_request', {
            method: req.method,
            path: req.path,
            status: res.statusCode,
            ms: Number((process.hrtime.bigint() - start) / 1000000n)
        });
    });
    next();
});

// Admin responses carry moderation data about real people. A shared cache or a
// browser back-forward cache must never keep them.
app.use('/api/admin', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Pragma', 'no-cache');
    next();
});

// Rate limiting
const reviewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many reviews. Please try again later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Please try again later.' }
});

const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Too many search requests. Please try again later.' }
});

const resetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: { error: 'Too many reset requests. Try again in an hour.' }
});

const questionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many questions. Please try again later.' }
});

// Reporting is cheap for a user and expensive for a moderator, so keep the
// per-IP budget tight. Duplicate reports for the same review are collapsed.
const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many reports. Please try again later.' }
});

// Admin account creation must not be reachable by a scanner. One attempt per
// hour per IP is plenty for a legitimate first-run setup.
const setupLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    message: { error: 'Too many setup attempts. Try again later.' }
});

// Consuming a reset token is bounded separately from requesting one, so a
// mistyped link does not burn the forgot-password budget while token guessing
// still stays expensive.
const resetUseLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many reset attempts. Try again later.' }
});

// Email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendEmail = async (to, subject, html) => {
    try {
        await transporter.sendMail({
            from: `"Teacher Reviews" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        });
        console.log(`✅ Email sent to ${to}`);
        return true;
    } catch (error) {
        console.error('❌ Email error:', error);
        return false;
    }
};

// ========== HELPER FUNCTIONS ==========

// JWTs are stateless, so a stolen token would otherwise stay valid until it
// expires. admins.token_version is the revocation switch: it is baked into the
// token as `tv` and compared on every admin request, so bumping the column
// (password reset) invalidates every outstanding session at once. The check is
// skipped if the column is not present yet, so a failed migration can never
// lock the admin out of their own panel.
let adminTokenVersionReady = false;

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

    if (!adminTokenVersionReady) {
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

// Body fields arrive from the network, so never assume a type: an object or
// array handed to bcrypt or a SQL parameter is both a bug and an attack
// surface. The length caps also stop a large payload from becoming a bcrypt
// cost amplifier.
const isText = (value, maxLen) => typeof value === 'string' && value.length > 0 && value.length <= maxLen;

// Query params and route params are attacker-controlled strings. Clamp them
// before they reach LIMIT/OFFSET, where MySQL rejects a negative value with a
// 500 instead of the 400 the caller deserves.
const clampInt = (value, fallback, min, max) => {
    const parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(Math.max(parsed, min), max);
};

// ========== TOTP TWO-FACTOR (RFC 6238, SHA1, 30s, 6 digits) ==========
// Deliberately dependency-free: the algorithm is ~40 lines and the only
// "secret" material it handles is a per-admin code, so pulling in otplib for
// it would not pay for its supply-chain surface.
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

const base32Encode = (buffer) => {
    let bits = 0;
    let value = 0;
    let out = '';
    for (const byte of buffer) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
            out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }
    if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    return out;
};

const base32Decode = (input) => {
    const clean = String(input || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
    if (!clean) return Buffer.alloc(0);
    let bits = 0;
    let value = 0;
    const bytes = [];
    for (const ch of clean) {
        value = (value << 5) | BASE32_ALPHABET.indexOf(ch);
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((value >>> bits) & 0xff);
        }
    }
    return Buffer.from(bytes);
};

const generateTotpSecret = () => base32Encode(crypto.randomBytes(20)); // 32 chars

// HOTP (RFC 4226) with the counter written big-endian, as TOTP uses.
const hotp = (secretBytes, counter) => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64BE(BigInt(counter));
    const hmac = crypto.createHmac('sha1', secretBytes).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0x0f;
    const code = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) |
        (hmac[offset + 2] << 8) | hmac[offset + 3];
    return String(code % 1_000_000).padStart(6, '0');
};

// Accept the current step plus one step either side so a phone whose clock is
// a minute off still works; the code is a 22-bit space, so a 3-way check does
// not meaningfully weaken brute-force resistance (the login is also
// rate-limited and the password still gates the request).
const totpVerify = (secret, code) => {
    const clean = String(code || '').replace(/\s+/g, '');
    if (!/^\d{6}$/.test(clean)) return false;
    const secretBytes = base32Decode(secret);
    if (secretBytes.length < 10) return false;
    const step = Math.floor(Date.now() / 1000 / 30);
    const given = Buffer.from(clean);
    for (let i = -1; i <= 1; i++) {
        const candidate = Buffer.from(hotp(secretBytes, step + i));
        if (crypto.timingSafeEqual(candidate, given)) return true;
    }
    return false;
};

const totpProvisioningUri = (secret, username) => {
    const label = `UMT Teacher Reviews:${username}`;
    const params = new URLSearchParams({
        issuer: 'UMT Teacher Reviews',
        algorithm: 'SHA1',
        digits: '6',
        period: '30',
        secret
    });
    return `otpauth://totp/${label}?${params.toString()}`;
};

// Hand the event loop a turn between expensive batches so a long sweep does
// not freeze every other request (and the platform health check).
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

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

// audit_logs used to keep req.ip forever, which turns a security log into a
// long-term record of who used the site. Store an HMAC instead: the same
// address always hashes to the same value (so abuse patterns still correlate)
// but the column cannot be read back into an IP. AUDIT_IP_SALT should stay
// stable if JWT_SECRET is ever rotated.
const hashIpForAudit = (ip) => {
    const value = String(ip || 'unknown').trim() || 'unknown';
    if (value === 'unknown' || value === 'system') return value;
    const salt = process.env.AUDIT_IP_SALT || JWT_SECRET;
    return `sha256:${crypto.createHmac('sha256', salt).update(value).digest('hex').slice(0, 32)}`;
};

const AUDIT_LOG_RETENTION_DAYS = clampInt(process.env.AUDIT_LOG_RETENTION_DAYS, 90, 7, 3650);

const pruneAuditLogs = async () => {
    try {
        const cutoff = new Date(Date.now() - AUDIT_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const [result] = await db.query('DELETE FROM audit_logs WHERE created_at < ?', [cutoff]);
        if (result.affectedRows > 0) {
            console.log(`🧹 Pruned ${result.affectedRows} audit log row(s) older than ${AUDIT_LOG_RETENTION_DAYS} days`);
        }
    } catch (error) {
        console.error('Audit log prune error:', error.message);
    }
};

const createAuditLog = async (adminId, action, details, ip = 'unknown') => {
    try {
        await db.query(
            'INSERT INTO audit_logs (admin_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [adminId, action, details, hashIpForAudit(ip)]
        );
    } catch (error) {
        console.error('Audit log error:', error);
    }
};

// ========== ZERO-RESULT SEARCH LOG ==========
// Students searching for a teacher who is not in the directory are telling us
// who to add next. Only zero-result queries are stored (they carry content
// information); successful searches are never logged, so the table is not a
// record of what anyone looked up. Retention below keeps it small.
const SEARCH_GAP_RETENTION_DAYS = 30;
let searchGapsReady = false;

const pruneSearchGaps = async () => {
    try {
        const cutoff = new Date(Date.now() - SEARCH_GAP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const [result] = await db.query('DELETE FROM search_gaps WHERE created_at < ?', [cutoff]);
        if (result.affectedRows > 0) {
            logJson('info', 'search_gaps_pruned', { deleted: result.affectedRows });
        }
    } catch (error) {
        console.error('Search gap prune error:', error.message);
    }
};

const recordSearchGap = (rawTerm) => {
    const term = String(rawTerm || '').trim().slice(0, 200);
    if (!term) return;
    db.query('INSERT INTO search_gaps (query) VALUES (?)', [term])
        .then(() => {
            logJson('info', 'search_zero_results', { query: term });
        })
        .catch((error) => {
            // Table may not exist yet on a cold deploy; never fail a search.
            console.error('Search gap log error:', error.message);
        });
};

// ========== DAILY MODERATION DIGEST ==========
// The free-tier backend sleeps, so pending items sit unseen until someone
// opens the panel. One email per day (only when something is actually waiting)
// keeps moderation from depending on remembering to look.
const DIGEST_RECIPIENT = (process.env.MODERATION_DIGEST_EMAIL || process.env.EMAIL_USER || '').trim();
let digestInFlight = false;

const sendModerationDigest = async (force = false) => {
    if (!DIGEST_RECIPIENT || digestInFlight) return;
    digestInFlight = true;
    try {
        // Mark today's digest before sending so a restart mid-day cannot
        // double-send; a failed send is retried on the next hourly tick only
        // if the marker insert itself failed.
        const today = new Date().toISOString().slice(0, 10);
        const [marker] = await db.query(
            "SELECT id FROM audit_logs WHERE action = 'DIGEST_SENT' AND details = ? LIMIT 1",
            [today]
        );
        if (marker.length > 0 && !force) return;

        const [pendingReviews] = await db.query('SELECT COUNT(*) as count FROM reviews WHERE is_approved = 0');
        const [pendingQuestions] = await db.query('SELECT COUNT(*) as count FROM questions WHERE is_approved = 0');
        const [pendingAnswers] = await db.query('SELECT COUNT(*) as count FROM question_answers WHERE is_approved = 0');
        const [pendingCourses] = await db.query("SELECT COUNT(*) as count FROM custom_courses WHERE status = 'pending'");
        let openReports = 0;
        try {
            const [rep] = await db.query("SELECT COUNT(*) as count FROM review_reports WHERE status = 'open'");
            openReports = rep[0].count || 0;
        } catch (_) { /* table may not exist yet */ }

        const total = pendingReviews[0].count + pendingQuestions[0].count + pendingAnswers[0].count + openReports;
        if (total === 0) {
            await db.query(
                "INSERT INTO audit_logs (action, details, ip_address) VALUES ('DIGEST_SENT', ?, 'system')",
                [today]
            );
            return;
        }

        const rows = [
            ['Reviews awaiting approval', pendingReviews[0].count],
            ['Questions awaiting approval', pendingQuestions[0].count],
            ['Answers awaiting approval', pendingAnswers[0].count],
            ['Course names awaiting review', pendingCourses[0].count],
            ['Open reader reports', openReports]
        ].filter(([, n]) => n > 0);

        const html = `
            <h2 style="margin:0 0 12px">Moderation digest — ${new Date().toDateString()}</h2>
            <table cellpadding="6" style="border-collapse:collapse">
                ${rows.map(([label, n]) => `<tr><td style="border-bottom:1px solid #eee">${label}</td><td style="border-bottom:1px solid #eee;text-align:right"><strong>${n}</strong></td></tr>`).join('')}
            </table>
            <p style="color:#64748b">Open the admin panel to moderate: ${PUBLIC_SITE_URL}/admin</p>
        `;
        await sendEmail(DIGEST_RECIPIENT, `Moderation digest: ${total} item${total === 1 ? '' : 's'} waiting`, html);
        await db.query(
            "INSERT INTO audit_logs (action, details, ip_address) VALUES ('DIGEST_SENT', ?, 'system')",
            [today]
        );
        logJson('info', 'digest_sent', { total, to: 'operator' });
    } catch (error) {
        console.error('Moderation digest error:', error.message);
    } finally {
        digestInFlight = false;
    }
};

// Mirrors isUsableImageUrl() in frontend/src/utils/imageThumb.ts, so the DB is
// cleaned using exactly the rule the UI uses to choose between a photo and an
// initials avatar. A bare directory URL such as
// "https://admin.umt.edu.pk/Media/UserProfile/" is not a usable image.
const isUsableTeacherImageUrl = (url) => {
    const trimmed = (url || '').trim();
    if (!/^https?:\/\//i.test(trimmed)) return false;
    try {
        const { hostname, pathname } = new URL(trimmed);
        if (!hostname) return false;
        const filename = pathname.split('/').filter(Boolean).pop() || '';
        return /\.(jpe?g|png|webp|gif|avif)$/i.test(filename);
    } catch (error) {
        return false;
    }
};

// ========== IN-MEMORY CACHE ==========
const { LRUCache } = require('lru-cache');
const cache = new LRUCache({
    max: 500, // Maximum number of items in cache
    ttl: 60 * 1000, // 60 seconds
});

const getCached = (key) => {
    return cache.get(key) || null;
};

const setCache = (key, data) => {
    cache.set(key, data);
};

const invalidateCache = (pattern) => {
    for (const key of cache.keys()) {
        if (key.startsWith(pattern)) cache.delete(key);
    }
};

// Normalises user text for duplicate comparison: lowercase, punctuation and
// whitespace collapsed, so "Best teacher!!" and "best   teacher" are equal.
const normalizeReviewText = (text) =>
    String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Marks set by the schema bootstrap below. Both default to false so a request
// that arrives while the DB is still migrating degrades instead of erroring.
let reviewModerationColumnReady = false;
let reviewReportsReady = false;

// Departments are free text on each teacher row, so normalise what an admin
// types: collapse whitespace, and reuse the spelling/case of an existing
// department (case-insensitive match) so "computer science" and
// "Computer Science" never become two separate filters.
const normalizeDepartment = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
const canonicalDepartment = async (value) => {
    const cleaned = normalizeDepartment(value);
    if (!cleaned) return cleaned;
    const [rows] = await db.query('SELECT department FROM teachers WHERE LOWER(department) = LOWER(?) LIMIT 1', [cleaned]);
    return rows.length > 0 ? rows[0].department : cleaned;
};

// ========== ONE-TIME RETROACTIVE REVIEW FILTER SWEEP ==========
// Runs the NLP content filter over reviews that existed before the filter
// was added: flagged approved reviews are queued for admin moderation.
// Gated by an audit_logs marker so it runs once (not on every boot); the
// admin endpoint POST /api/admin/filter-reviews re-runs it explicitly.
let reviewSweepAttempts = 0;
let reviewSweepDone = false;

const runReviewFilterSweep = async () => {
    if (reviewSweepDone) return;
    try {
        const [marker] = await db.query("SELECT id FROM audit_logs WHERE action = 'SWEEP_REVIEWS' LIMIT 1");
        if (marker.length > 0) {
            reviewSweepDone = true;
            return;
        }
        const result = await sweepExistingReviews(db);
        if (result.toQueue > 0) invalidateCache('teachers');
        reviewSweepDone = true;
        await db.query(
            "INSERT INTO audit_logs (action, details, ip_address) VALUES ('SWEEP_REVIEWS', ?, 'system')",
            [JSON.stringify({ scanned: result.scanned, queued: result.toQueue, alreadyQueued: result.alreadyQueued })]
        );
        console.log(`🔎 Review filter sweep: scanned ${result.scanned}, queued ${result.toQueue} for admin review (${result.alreadyQueued} already queued)`);
    } catch (error) {
        reviewSweepAttempts += 1;
        console.error('❌ Review filter sweep failed:', error.message);
        // The DB may still be warming up (or schema.sql not applied yet).
        if (reviewSweepAttempts < 10) setTimeout(runReviewFilterSweep, 30000);
    }
};

// One-time retroactive sweep for questions, answers and custom courses
// (marker action SWEEP_QA keeps it independent from the reviews sweep).
let qaSweepAttempts = 0;
let qaSweepDone = false;

const runQaFilterSweep = async () => {
    if (qaSweepDone) return;
    try {
        const [marker] = await db.query("SELECT id FROM audit_logs WHERE action = 'SWEEP_QA' LIMIT 1");
        if (marker.length > 0) {
            qaSweepDone = true;
            return;
        }
        const result = await sweepExistingQa(db);
        qaSweepDone = true;
        await db.query(
            "INSERT INTO audit_logs (action, details, ip_address) VALUES ('SWEEP_QA', ?, 'system')",
            [JSON.stringify({
                questions: result.questions.toQueue,
                answers: result.answers.toQueue,
                courses: result.courses.toDemote
            })]
        );
        console.log(`🔎 Q&A filter sweep: ${result.questions.toQueue} question(s), ${result.answers.toQueue} answer(s), ${result.courses.toDemote} course(s) queued`);
    } catch (error) {
        qaSweepAttempts += 1;
        console.error('❌ Q&A filter sweep failed:', error.message);
        if (qaSweepAttempts < 10) setTimeout(runQaFilterSweep, 30000);
    }
};

// One-time backfill: mark existing reviews that contain conduct allegations so
// they surface first in the admin queue. It only sets a triage marker and
// never changes approval state, so it cannot publish or hide anything.
// Versioned: bump SENSITIVE_BACKFILL_VERSION when the lexicon improves so the
// already-processed rows are re-scanned exactly once.
const SENSITIVE_BACKFILL_VERSION = 2;
let sensitiveBackfillAttempts = 0;
let sensitiveBackfillDone = false;

const runSensitiveReviewBackfill = async () => {
    if (sensitiveBackfillDone || !reviewModerationColumnReady) return;
    try {
        const [marker] = await db.query(
            "SELECT id, details FROM audit_logs WHERE action = 'FLAG_SENSITIVE_REVIEWS' ORDER BY id DESC LIMIT 1"
        );
        if (marker.length > 0) {
            let appliedVersion = 1;
            try {
                appliedVersion = Number(JSON.parse(marker[0].details || '{}').version) || 1;
            } catch (parseErr) {
                appliedVersion = 1;
            }
            if (appliedVersion >= SENSITIVE_BACKFILL_VERSION) {
                sensitiveBackfillDone = true;
                return;
            }
        }

        const BATCH = 500;
        let lastId = 0;
        let scanned = 0;
        const flaggedIds = [];
        for (;;) {
            const [rows] = await db.query(
                `SELECT id, comment, user_name, courses FROM reviews
                 WHERE id > ? AND (moderation_flag IS NULL OR moderation_flag <> 'sensitive')
                 ORDER BY id ASC LIMIT ?`,
                [lastId, BATCH]
            );
            if (rows.length === 0) break;
            scanned += rows.length;
            lastId = Number(rows[rows.length - 1].id);
            for (const row of rows) {
                const text = `${row.comment || ''} ${row.user_name || ''} ${row.courses || ''}`;
                if (moderationFlagFor(text) === 'sensitive') flaggedIds.push(row.id);
            }
            if (rows.length < BATCH) break;
            await yieldToEventLoop();
        }
        const CHUNK = 500;
        for (let i = 0; i < flaggedIds.length; i += CHUNK) {
            const chunk = flaggedIds.slice(i, i + CHUNK);
            await db.query(
                `UPDATE reviews SET moderation_flag = 'sensitive' WHERE id IN (${chunk.map(() => '?').join(',')})`,
                chunk
            );
        }

        sensitiveBackfillDone = true;
        await db.query(
            "INSERT INTO audit_logs (action, details, ip_address) VALUES ('FLAG_SENSITIVE_REVIEWS', ?, 'system')",
            [JSON.stringify({ version: SENSITIVE_BACKFILL_VERSION, scanned, flagged: flaggedIds.length })]
        );
        console.log(`🔎 Sensitive-review backfill v${SENSITIVE_BACKFILL_VERSION}: scanned ${scanned}, flagged ${flaggedIds.length}`);
    } catch (error) {
        sensitiveBackfillAttempts += 1;
        console.error('❌ Sensitive-review backfill failed:', error.message);
        if (sensitiveBackfillAttempts < 10) setTimeout(runSensitiveReviewBackfill, 30000);
    }
};

// ========== SCHEMA BOOTSTRAP ==========
// Creates tables that may be added after the initial deployment, so the
// server can auto-migrate on Render without manual SQL.
let schemaBootstrapError = null;
let schemaBootstrapDone = false;

// MySQL has no "ADD INDEX IF NOT EXISTS", so check the catalogue first.
const ensureIndex = async (table, indexName, definition) => {
    try {
        const [rows] = await db.query(
            `SELECT 1 FROM information_schema.statistics
              WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
              LIMIT 1`,
            [table, indexName]
        );
        if (rows.length === 0) {
            await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` ${definition}`);
            console.log(`✅ Added index ${indexName} on ${table}`);
        }
    } catch (error) {
        console.error(`⚠️ Could not ensure index ${indexName} on ${table}:`, error.message);
    }
};

const runSchemaBootstrap = async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS questions (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                teacher_id INT NOT NULL,
                question TEXT NOT NULL,
                is_approved TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_questions_teacher (teacher_id, is_approved)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS question_answers (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                question_id INT UNSIGNED NOT NULL,
                answer TEXT NOT NULL,
                is_approved TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_answers_question (question_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        // Custom courses: user-added course names awaiting admin approval
        await db.query(`
            CREATE TABLE IF NOT EXISTS custom_courses (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                name VARCHAR(200) NOT NULL,
                name_key VARCHAR(200) NOT NULL,
                status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
                times_used INT UNSIGNED NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TIMESTAMP NULL DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_custom_course_key (name_key),
                KEY idx_custom_courses_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        // Drop the old review_votes table (vote feature removed)
        await db.query('DROP TABLE IF EXISTS review_votes');

        // Add courses column to reviews if it doesn't exist (standalone try-catch)
        try {
            const [coursesCol] = await db.query("SHOW COLUMNS FROM reviews LIKE 'courses'");
            const [courseCol] = await db.query("SHOW COLUMNS FROM reviews LIKE 'course'");
            if (coursesCol.length === 0 && courseCol.length === 0) {
                await db.query('ALTER TABLE reviews ADD COLUMN courses VARCHAR(2000) NULL AFTER user_name');
                console.log('✅ Added courses column to reviews table');
            } else if (courseCol.length > 0 && coursesCol.length === 0) {
                await db.query('ALTER TABLE reviews CHANGE course courses VARCHAR(2000) NULL');
                console.log('✅ Renamed course column to courses');
            } else {
                console.log('✅ Courses column already exists');
            }
        } catch (colErr) {
            console.error('⚠️ Could not ensure courses column:', colErr.message);
        }

        // Triage marker for reviews that need a human decision before they go
        // public (harassment/threat allegations). NULL means "no signal".
        try {
            const [flagCol] = await db.query("SHOW COLUMNS FROM reviews LIKE 'moderation_flag'");
            if (flagCol.length === 0) {
                await db.query('ALTER TABLE reviews ADD COLUMN moderation_flag VARCHAR(40) NULL AFTER is_approved');
                console.log('✅ Added moderation_flag column to reviews table');
            }
            reviewModerationColumnReady = true;
        } catch (flagErr) {
            console.error('⚠️ Could not ensure moderation_flag column:', flagErr.message);
        }

        // rating is a legacy column: the UI no longer collects it. The old
        // NOT NULL DEFAULT 5 silently recorded every new review as five stars,
        // which poisoned anything that averages ratings. Make it nullable so
        // new rows are honestly empty, and leave existing values untouched.
        try {
            const [ratingCol] = await db.query("SHOW COLUMNS FROM reviews LIKE 'rating'");
            if (ratingCol.length > 0 && ratingCol[0].Null === 'NO') {
                await db.query('ALTER TABLE reviews MODIFY COLUMN rating TINYINT UNSIGNED NULL DEFAULT NULL');
                console.log('✅ reviews.rating is now nullable (legacy column, no longer written)');
            }
        } catch (ratingErr) {
            console.error('⚠️ Could not relax reviews.rating:', ratingErr.message);
        }

        // Reader reports on published reviews. No FK on review_id, matching the
        // questions table, so the bootstrap works with either INT type.
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS review_reports (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    review_id INT UNSIGNED NOT NULL,
                    reason VARCHAR(300) NOT NULL,
                    reporter_hash CHAR(64) NOT NULL,
                    status ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_review_report_once (review_id, reporter_hash),
                    KEY idx_review_reports_status (status)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            reviewReportsReady = true;
        } catch (reportsErr) {
            console.error('⚠️ Could not ensure review_reports table:', reportsErr.message);
        }

        // Session revocation switch (see verifyAdmin). Existing admins start at
        // 0, which matches tokens issued before this column existed, so nobody
        // is logged out by the migration itself.
        try {
            const [tvCol] = await db.query("SHOW COLUMNS FROM admins LIKE 'token_version'");
            if (tvCol.length === 0) {
                await db.query('ALTER TABLE admins ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0');
                console.log('✅ Added token_version column to admins table');
            }
            adminTokenVersionReady = true;
        } catch (tvErr) {
            console.error('⚠️ Could not ensure admins.token_version column:', tvErr.message);
        }
        // Optional TOTP two-factor column. Defaults allow the auth path to work
        // for all existing admins without touching their rows.
        try {
            const [totpCols] = await db.query("SHOW COLUMNS FROM admins LIKE 'totp_enabled'");
            if (totpCols.length === 0) {
                await db.query('ALTER TABLE admins ADD COLUMN totp_secret VARCHAR(64) DEFAULT NULL');
                await db.query('ALTER TABLE admins ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0');
                console.log('✅ Added TOTP columns to admins table');
            }
        } catch (totpErr) {
            console.error('⚠️ Could not ensure admins.totp_* columns:', totpErr.message);
        }
        // Zero-result search terms (content-gap signals). Pruned after 30 days.
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS search_gaps (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    query VARCHAR(200) NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    KEY idx_search_gaps_created (created_at),
                    KEY idx_search_gaps_query (query)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            searchGapsReady = true;
        } catch (gapsErr) {
            console.error('⚠️ Could not ensure search_gaps table:', gapsErr.message);
        }

        // Composite indexes for the two hottest list queries: department pages
        // (WHERE department = ? ORDER BY name) and the public Q&A board
        // (WHERE is_approved = 1 ORDER BY created_at DESC).
        await ensureIndex('teachers', 'idx_teachers_department_name', '(department, name)');
        await ensureIndex('questions', 'idx_questions_approved_created', '(is_approved, created_at)');

        schemaBootstrapError = null;
        schemaBootstrapDone = true;
        console.log('✅ Schema bootstrap complete (questions, question_answers, custom_courses, review_reports, cleanup)');
        // Keep the audit trail bounded (and the hashed IPs with it).
        pruneAuditLogs();
        pruneSearchGaps();
        // Schema is up: retroactively filter any pre-existing reviews.
        runReviewFilterSweep();
        runQaFilterSweep();
        runSensitiveReviewBackfill();
    } catch (error) {
        schemaBootstrapError = error.message;
        console.error('❌ Schema bootstrap failed:', error.message);
        // Retry a few times: the DB connection may still be warming up on cold start
        setTimeout(runSchemaBootstrap, 5000);
    }
};

// Retry wrapper: also allow manual re-trigger via /api/admin/retry-schema
let schemaRetryTimer = null;
const ensureTables = () => {
    if (schemaRetryTimer) clearTimeout(schemaRetryTimer);
    runSchemaBootstrap();
};

ensureTables();
// Render instances can stay up for weeks, so prune on a timer as well as on
// boot. unref() keeps the timer from holding the process open.
setInterval(pruneAuditLogs, 24 * 60 * 60 * 1000).unref();
setInterval(pruneSearchGaps, 24 * 60 * 60 * 1000).unref();
// Hourly check; the marker row makes it a at-most-once-per-day digest.
setInterval(() => sendModerationDigest(), 60 * 60 * 1000).unref();
// Give the schema bootstrap a moment on cold start, then try once today.
setTimeout(() => sendModerationDigest(), 90 * 1000).unref();

// ========== PUBLIC API ENDPOINTS ==========

// GET /api/teachers - paginated list (20 per page by default)
// Supports: ?page=N&limit=20..200&sort=name|reviews|newest&department=<name>&course=<name>
app.get('/api/teachers', async (req, res) => {
    try {
        const page = clampInt(req.query.page, 1, 1, 100000);
        // limit: the admin panel pulls the whole teacher list in big pages so
        // its sorting covers every row; public callers keep the default of 20.
        const limit = clampInt(req.query.limit, 20, 1, 200);
        const offset = (page - 1) * limit;
        const sort = req.query.sort || 'name';
        const department = req.query.department || '';
        const course = req.query.course || '';

        // An admin must never see a cached list from before their last
        // add/approve/delete. Public visitors keep the 60s shared cache.
        const bypassCache = Boolean(parseCookies(req).admin_token);
        const cacheControl = bypassCache ? 'private, no-store' : 'public, max-age=60';

        // Cache key includes course filter so different courses get distinct entries
        const cacheKey = `teachers:${page}:${limit}:${sort}:${department}:${course}`;
        const cached = bypassCache ? null : getCached(cacheKey);
        if (cached) {
            res.set('Cache-Control', cacheControl);
            return res.json(cached);
        }

        let orderBy = 't.name';
        if (sort === 'reviews') orderBy = 'review_count DESC, t.name';
        else if (sort === 'newest') orderBy = 't.created_at DESC';

        // Build WHERE clause from optional filters
        const clauses = [];
        const params = [];
        if (department) {
            clauses.push('t.department = ?');
            params.push(department);
        }
        if (course) {
            // Find teachers who have been reviewed for this course (exact or partial match)
            clauses.push(`t.id IN (
                SELECT DISTINCT r.teacher_id FROM reviews r
                WHERE r.is_approved = 1 AND r.courses IS NOT NULL
                AND LOWER(r.courses) LIKE LOWER(?)
            )`);
            params.push(`%${course}%`);
        }
        const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';

        const query = `
            SELECT t.*,
                   (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id = t.id AND r.is_approved = 1) as review_count
            FROM teachers t
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `;
        
        const [teachers] = await db.query(query, [...params, limit, offset]);

        const countQuery = `SELECT COUNT(*) as total FROM teachers t ${whereClause}`;
        const [countResult] = await db.query(countQuery, params);
        const total = countResult[0].total;

        const result = {
            teachers: teachers,
            pagination: {
                page: page,
                limit: limit,
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        };

        setCache(cacheKey, result);
        res.set('Cache-Control', cacheControl);
        res.json(result);
    } catch (error) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/departments - distinct departments with teacher counts
app.get('/api/departments', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT department, COUNT(*) as teacher_count
            FROM teachers
            GROUP BY department
            ORDER BY department
        `);
        // Revalidate every time (cheap 304 via ETag) so a department an admin
        // just added shows up in the site filter immediately, not an hour later.
        res.set('Cache-Control', 'no-cache');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching departments:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/teachers/search - search all teachers (no pagination)
// Supports: ?q=<term>&limit=N (limit used for autocomplete)
// Fuzzy matching: exact, prefix, substring, SOUNDEX (typo-tolerant), word-order tolerant
app.get('/api/teachers/search', searchLimiter, async (req, res) => {
    try {
        const searchTerm = req.query.q;
        const limit = clampInt(req.query.limit, 0, 0, 50);
        if (!searchTerm || searchTerm.trim() === '') {
            return res.json([]);
        }

        const term = searchTerm.trim();
        if (term.length > 100) {
            return res.status(400).json({ error: 'Search term is too long' });
        }
        // LIKE wildcards are user input, not syntax: unescaped, q=_ matches
        // every teacher and q=% returns the whole table. MySQL's default escape
        // character is backslash, so doubling it is enough.
        const like = term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
        // Per-word SOUNDEX: MySQL's SOUNDEX truncates to 4 chars over the whole
        // string, so a multi-word name shifts the code. Compare first/last word
        // of the name against first/last word of the query so "Muhamad" matches
        // "Muhammad Ali".
        const [teachers] = await db.query(`
            SELECT t.*,
                   (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id = t.id AND r.is_approved = 1) as review_count,
                   CASE
                       WHEN t.name = ? THEN 0
                       WHEN t.name LIKE ? THEN 1
                       WHEN t.name LIKE ? THEN 2
                       WHEN SOUNDEX(SUBSTRING_INDEX(t.name, ' ', 1)) = SOUNDEX(SUBSTRING_INDEX(?, ' ', 1)) THEN 3
                       WHEN SOUNDEX(SUBSTRING_INDEX(t.name, ' ', -1)) = SOUNDEX(SUBSTRING_INDEX(?, ' ', -1)) THEN 3
                       WHEN t.department LIKE ? THEN 4
                       ELSE 5
                   END as match_rank
            FROM teachers t
            WHERE t.name = ?
               OR t.name LIKE ?
               OR t.name LIKE ?
               OR SOUNDEX(SUBSTRING_INDEX(t.name, ' ', 1)) = SOUNDEX(SUBSTRING_INDEX(?, ' ', 1))
               OR SOUNDEX(SUBSTRING_INDEX(t.name, ' ', -1)) = SOUNDEX(SUBSTRING_INDEX(?, ' ', -1))
               OR t.department LIKE ?
            ORDER BY match_rank, t.name
            ${limit > 0 ? 'LIMIT ?' : ''}
        `, [
            term, `${like}%`, `%${like}%`, term, term, `%${like}%`,
            term, `${like}%`, `%${like}%`, term, term, `%${like}%`,
            ...(limit > 0 ? [limit] : [])
        ]);

        // Zero-result searches are content-gap signals (see search_gaps).
        if (teachers.length === 0 && searchGapsReady) {
            recordSearchGap(term);
        }

        res.set('Cache-Control', 'public, max-age=120');
        res.json(teachers);
    } catch (error) {
        console.error('Error searching teachers:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== NEW: GET SINGLE TEACHER WITH REVIEWS ==========
app.get('/api/teachers/:id', async (req, res) => {
    try {
        const teacherId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(teacherId) || teacherId < 1) {
            return res.status(400).json({ error: 'Invalid teacher ID' });
        }

        // Reviews are paginated so a heavily reviewed teacher cannot return an
        // unbounded payload. Callers that omit the params keep the old shape
        // (first page, newest first).
        const reviewPage = clampInt(req.query.review_page, 1, 1, 100000);
        const reviewLimit = clampInt(req.query.review_limit, 50, 1, 100);
        const reviewOffset = (reviewPage - 1) * reviewLimit;

        // Get teacher
        const [teachers] = await db.query(
            'SELECT * FROM teachers WHERE id = ?',
            [teacherId]
        );
        if (teachers.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // Get approved reviews for this teacher. Columns are listed explicitly
        // so internal moderation fields (moderation_flag) never reach the
        // public API, even though the row is approved.
        const [reviews] = await db.query(
            `SELECT r.id, r.teacher_id, r.comment, r.user_name, r.courses, r.is_approved, r.created_at
             FROM reviews r
             WHERE r.teacher_id = ? AND r.is_approved = 1
             ORDER BY r.created_at DESC
             LIMIT ? OFFSET ?`,
            [teacherId, reviewLimit, reviewOffset]
        );

        // Get total review count
        const [countData] = await db.query(
            'SELECT COUNT(*) as total FROM reviews WHERE teacher_id = ? AND is_approved = 1',
            [teacherId]
        );
        const totalReviews = countData[0].total || 0;


        res.json({
            teacher: teachers[0],
            reviews: reviews,
            total_reviews: totalReviews,
            review_pagination: {
                page: reviewPage,
                limit: reviewLimit,
                total: totalReviews,
                totalPages: Math.max(1, Math.ceil(totalReviews / reviewLimit))
            }
        });
    } catch (error) {
        console.error('Error fetching teacher details:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/teachers/:id/related - other teachers in the same department
app.get('/api/teachers/:id/related', async (req, res) => {
    try {
        const teacherId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(teacherId) || teacherId < 1) {
            return res.status(400).json({ error: 'Invalid teacher ID' });
        }
        const [teachers] = await db.query('SELECT department FROM teachers WHERE id = ?', [teacherId]);
        if (teachers.length === 0) return res.status(404).json({ error: 'Teacher not found' });

        const [related] = await db.query(`
            SELECT t.id, t.name, t.department, t.image_url,
                   (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id = t.id AND r.is_approved = 1) as review_count
            FROM teachers t
            WHERE t.department = ? AND t.id != ?
            ORDER BY t.name
            LIMIT 6
        `, [teachers[0].department, teacherId]);

        res.set('Cache-Control', 'public, max-age=300');
        res.json(related);
    } catch (error) {
        console.error('Error fetching related teachers:', error);
        res.status(500).json({ error: 'Database error' });
    }
});


app.get('/api/teachers/:id/questions', async (req, res) => {
    try {
        const teacherId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(teacherId) || teacherId < 1) {
            return res.status(400).json({ error: 'Invalid teacher ID' });
        }
        const [teachers] = await db.query('SELECT id FROM teachers WHERE id = ?', [teacherId]);
        if (teachers.length === 0) return res.status(404).json({ error: 'Teacher not found' });

        const [rows] = await db.query(`
            SELECT q.id as question_id, q.question, q.created_at as question_created_at,
                   a.id as answer_id, a.answer, a.created_at as answer_created_at
            FROM questions q
            LEFT JOIN question_answers a ON a.question_id = q.id AND a.is_approved = 1
            WHERE q.teacher_id = ? AND q.is_approved = 1
            ORDER BY q.created_at DESC, a.created_at ASC
        `, [teacherId]);

        // Group answers under their question
        const grouped = [];
        const map = {};
        rows.forEach((row) => {
            if (!map[row.question_id]) {
                map[row.question_id] = {
                    id: row.question_id,
                    question: row.question,
                    created_at: row.question_created_at,
                    answers: []
                };
                grouped.push(map[row.question_id]);
            }
            if (row.answer_id) {
                map[row.question_id].answers.push({
                    id: row.answer_id,
                    answer: row.answer,
                    created_at: row.answer_created_at
                });
            }
        });

        // Q&A is dynamic user content – never cache it publicly or the
        // Cloudflare layer in front of Render will serve stale (empty)
        // responses after a new question/answer is posted.
        res.set('Cache-Control', 'no-store');
        res.json(grouped);
    } catch (error) {
        console.error('Error fetching questions:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/questions - list every approved question across all teachers.
// Powers the public Q&A board, so students can read and answer questions
// without first opening a specific teacher page. Each row carries the
// teacher's name/department so the client can label and link it.
app.get('/api/questions', async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 15, 1), 50);
        const offset = (page - 1) * limit;

        const [countResult] = await db.query(
            'SELECT COUNT(*) as total FROM questions WHERE is_approved = 1'
        );
        const total = countResult[0].total;

        // Page over questions, not over the question x answer join. LIMIT/OFFSET
        // on joined rows splits a question with many answers across pages (or
        // repeats it) and makes totalPages disagree with what is rendered.
        const [questionRows] = await db.query(`
            SELECT q.id as question_id, q.question, q.created_at as question_created_at,
                   t.id as teacher_id, t.name as teacher_name, t.department as teacher_department
            FROM questions q
            JOIN teachers t ON t.id = q.teacher_id
            WHERE q.is_approved = 1
            ORDER BY q.created_at DESC, q.id DESC
            LIMIT ? OFFSET ?
        `, [limit, offset]);

        const questionIds = questionRows.map((row) => row.question_id);
        let answerRows = [];
        if (questionIds.length > 0) {
            const placeholders = questionIds.map(() => '?').join(', ');
            [answerRows] = await db.query(`
                SELECT id as answer_id, question_id, answer, created_at as answer_created_at
                FROM question_answers
                WHERE question_id IN (${placeholders}) AND is_approved = 1
                ORDER BY created_at ASC, id ASC
            `, questionIds);
        }

        // Group answers under their question (same shape as the teacher Q&A feed)
        const byQuestion = new Map();
        const grouped = questionRows.map((row) => {
            const item = {
                id: row.question_id,
                question: row.question,
                created_at: row.question_created_at,
                teacher_id: row.teacher_id,
                teacher_name: row.teacher_name,
                teacher_department: row.teacher_department,
                answers: []
            };
            byQuestion.set(row.question_id, item);
            return item;
        });
        answerRows.forEach((row) => {
            const item = byQuestion.get(row.question_id);
            if (item) {
                item.answers.push({
                    id: row.answer_id,
                    answer: row.answer,
                    created_at: row.answer_created_at
                });
            }
        });

        // Dynamic user content – bypass the CDN cache so newly approved
        // questions/answers show up immediately.
        res.set('Cache-Control', 'no-store');
        res.json({
            questions: grouped,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit))
            }
        });
    } catch (error) {
        console.error('Error fetching questions board:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/questions - ask a question about a teacher
app.post('/api/questions', questionLimiter, [
    body('teacher_id').isInt({ min: 1 }).withMessage('Invalid teacher ID'),
    body('question').isLength({ min: 3, max: 500 }).withMessage('Question must be 3-500 characters')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const { teacher_id, question } = req.body;
        const sanitizedQuestion = question.trim().slice(0, 1000);

        const [teachers] = await db.query('SELECT id FROM teachers WHERE id = ?', [teacher_id]);
        if (teachers.length === 0) return res.status(404).json({ error: 'Teacher not found' });

        // Moderation-first: every question starts pending (is_approved=0)
        // and only becomes public once an admin approves it in the panel.
        const [result] = await db.query(
            `INSERT INTO questions (teacher_id, question, is_approved) VALUES (?, ?, ?)`,
            [teacher_id, sanitizedQuestion, 0]
        );

        res.json({
            success: true,
            question_id: result.insertId,
            pending: true,
            message: 'Question submitted - it will appear once approved.'
        });
    } catch (error) {
        console.error('Error saving question:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/questions/:id/answers - answer an existing question
app.post('/api/questions/:id/answers', questionLimiter, [
    body('answer').isLength({ min: 1, max: 500 }).withMessage('Answer must be 1-500 characters')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const questionId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(questionId) || questionId < 1) {
            return res.status(400).json({ error: 'Invalid question ID' });
        }
        const { answer } = req.body;
        const sanitizedAnswer = answer.trim().slice(0, 1000);

        const [questions] = await db.query('SELECT id FROM questions WHERE id = ? AND is_approved = 1', [questionId]);
        if (questions.length === 0) return res.status(404).json({ error: 'Question not found' });

        // Moderation-first: every answer starts pending (is_approved=0)
        // and only becomes public once an admin approves it in the panel.
        const [result] = await db.query(
            `INSERT INTO question_answers (question_id, answer, is_approved) VALUES (?, ?, ?)`,
            [questionId, sanitizedAnswer, 0]
        );

        res.json({
            success: true,
            answer_id: result.insertId,
            pending: true,
            message: 'Answer submitted - it will appear once approved.'
        });
    } catch (error) {
        console.error('Error saving answer:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/reviews - submit a new review
app.post('/api/reviews', reviewLimiter, [
    body('teacher_id').isInt({ min: 1 }).withMessage('Invalid teacher ID'),
    // 15 characters is the point where a review says something. Three-character
    // entries ("ok", "bad") were 23% of the corpus and carry no information.
    body('comment')
        .customSanitizer((value) => String(value || '').trim())
        .isLength({ min: 15, max: 1000 })
        .withMessage('Review must be between 15 and 1000 characters'),
    body('user_name').optional().isLength({ max: 100 }).withMessage('Name too long')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, code: 'VALIDATION_ERROR' });
    }

    try {
        const { teacher_id, comment, user_name, courses } = req.body;
        const sanitizedComment = String(comment).trim().slice(0, 1000);
        const normalizedComment = normalizeReviewText(sanitizedComment);
        if (normalizedComment.length < 15) {
            return res.status(400).json({
                error: 'Review must be between 15 and 1000 characters',
                code: 'VALIDATION_ERROR'
            });
        }

        const sanitizedName = user_name ? String(user_name).trim().slice(0, 100) : 'Anonymous';
        // Accept courses as array, store as JSON string
        const courseList = Array.isArray(courses)
            ? courses.map((c) => String(c).trim().slice(0, 200)).filter(Boolean)
            : [];
        const sanitizedCourses = courseList.length > 0 ? JSON.stringify(courseList) : null;

        const [teachers] = await db.query('SELECT id FROM teachers WHERE id = ?', [teacher_id]);
        if (teachers.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // Duplicate guard: the same text posted twice for the same teacher is
        // always spam, whether from a double-tap or a copied review. Comparing
        // normalised text catches "best teacher" vs "Best Teacher!!".
        const [existing] = await db.query(
            'SELECT id, comment FROM reviews WHERE teacher_id = ? ORDER BY id DESC LIMIT 200',
            [teacher_id]
        );
        const duplicate = existing.find((row) => normalizeReviewText(row.comment) === normalizedComment);
        if (duplicate) {
            return res.status(409).json({
                error: 'You have already submitted this review for this teacher.',
                code: 'DUPLICATE_REVIEW'
            });
        }

        // Triage flag: sensitive allegations must be seen by a human first.
        // Every review starts pending, so this never blocks or auto-publishes.
        const reviewFlag = moderationFlagFor(`${sanitizedComment} ${courseList.join(' ')}`)
            || (detectFlaggedText(sanitizedName).flagged ? 'profanity' : null);

        const columns = ['teacher_id', 'comment', 'user_name', 'courses', 'is_approved'];
        const values = [teacher_id, sanitizedComment, sanitizedName, sanitizedCourses, 0];
        if (reviewModerationColumnReady) {
            columns.push('moderation_flag');
            values.push(reviewFlag);
        }

        const [result] = await db.query(
            `INSERT INTO reviews (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
            values
        );

        if (reviewFlag) {
            console.log(`🛡️ Review ${result.insertId} queued with moderation_flag=${reviewFlag}`);
        }

        invalidateCache('teachers');
        res.json({
            success: true,
            review_id: result.insertId,
            pending: true,
            message: 'Review submitted - it will appear publicly once approved.'
        });
    } catch (error) {
        console.error('Error saving review:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/reviews/:id/report - flag a published review for an admin
app.post('/api/reviews/:id/report', reportLimiter, [
    body('reason')
        .customSanitizer((value) => String(value || '').trim())
        .isLength({ min: 3, max: 300 })
        .withMessage('Please give a short reason (3-300 characters)')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, code: 'VALIDATION_ERROR' });
    }

    if (!reviewReportsReady) {
        return res.status(503).json({ error: 'Reporting is temporarily unavailable. Please try again shortly.' });
    }

    try {
        const reviewId = parseInt(req.params.id, 10);
        if (!Number.isInteger(reviewId) || reviewId < 1) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const [reviews] = await db.query('SELECT id FROM reviews WHERE id = ? AND is_approved = 1', [reviewId]);
        if (reviews.length === 0) {
            return res.status(404).json({ error: 'Review not found' });
        }

        // Store a salted hash instead of the reporter's IP: enough to collapse
        // repeat reports from one client, nothing to identify them by.
        const reporterHash = crypto
            .createHash('sha256')
            .update(`${req.ip || 'unknown'}|${JWT_SECRET}`)
            .digest('hex');

        await db.query(
            `INSERT INTO review_reports (review_id, reason, reporter_hash)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE id = id`,
            [reviewId, String(req.body.reason).trim().slice(0, 300), reporterHash]
        );

        await createAuditLog(null, 'REPORT_REVIEW', `Reported review ID: ${reviewId}`, req.ip);
        res.json({ success: true, message: 'Report received. An admin will take a look.' });
    } catch (error) {
        console.error('Error reporting review:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== ADMIN API ENDPOINTS ==========

app.post('/api/admin/login', loginLimiter, csrfValidate, async (req, res) => {
    try {
        const { username, password, totp_code } = req.body || {};
        if (!isText(username, 100) || !isText(password, 200)) {
            return res.status(400).json({ error: 'Username and password are required' });
        }
        const [admins] = await db.query('SELECT * FROM admins WHERE username = ?', [username]);
        if (admins.length === 0) {
            // Burn the same time a real comparison would take before answering.
            await bcrypt.compare(password, DUMMY_HASH);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        const admin = admins[0];
        const isValid = await bcrypt.compare(password, admin.password);
        if (!isValid) {
            const alreadyLocked = admin.locked_until && new Date(admin.locked_until) > new Date();
            if (!alreadyLocked) {
                const failedAttempts = (admin.failed_attempts || 0) + 1;
                const lockedUntil = failedAttempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
                await db.query('UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?', [failedAttempts, lockedUntil, admin.id]);
                if (lockedUntil) {
                    await createAuditLog(null, 'LOGIN_LOCKOUT', `Locked after ${failedAttempts} failed attempts`, req.ip);
                    sendEmail(
                        admin.email,
                        'Security alert: repeated failed admin logins',
                        `<p>There were ${failedAttempts} failed login attempts for the admin account <strong>${admin.username}</strong> from ${req.ip || 'an unknown address'}.</p><p>Your password still works. If this was not you, change it now.</p>`
                    );
                }
            }
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        // If 2FA is enabled on this account, require the TOTP code before
        // issuing a session cookie.
        if (admin.totp_enabled && admin.totp_secret) {
            if (!totp_code) {
                return res.status(200).json({ requires_totp: true });
            }
            if (!totpVerify(admin.totp_secret, totp_code)) {
                await createAuditLog(admin.id, '2FA_FAILED', 'Invalid TOTP code during login', req.ip);
                return res.status(401).json({ error: 'Invalid 2FA code' });
            }
        }

        await db.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [admin.id]);
        const token = signAdminToken(admin);
        await createAuditLog(admin.id, 'LOGIN', 'Admin logged in', req.ip);
        res.cookie('admin_token', token, buildCookieOptions(req));
        res.json({ success: true, admin: { id: admin.id, username: admin.username } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login error' });
    }
});

// GET /api/admin/me - validate the current admin session
app.get('/api/admin/me', verifyAdmin, async (req, res) => {
    try {
        // The panel uses this to show the 2FA state; a column that predates the
        // migration must not 500 the whole session check.
        let totp_enabled = 0;
        try {
            const [rows] = await db.query('SELECT totp_enabled FROM admins WHERE id = ?', [req.admin.id]);
            totp_enabled = rows[0]?.totp_enabled ? 1 : 0;
        } catch (_) { /* totp_enabled column not migrated yet */ }
        res.json({ admin: { id: req.admin.id, username: req.admin.username, totp_enabled } });
    } catch (error) {
        console.error('/api/admin/me error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/2fa/setup - start two-factor enrollment.
// Saves a fresh secret (totp_enabled stays 0 until the code is confirmed) and
// returns an otpauth:// URI the phone scans. Calling it again before enabling
// replaces the secret, so a mistyped enrollment never strands the account.
app.post('/api/admin/2fa/setup', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const secret = generateTotpSecret();
        await db.query('UPDATE admins SET totp_secret = ?, totp_enabled = 0 WHERE id = ?', [secret, req.admin.id]);
        await createAuditLog(req.admin.id, '2FA_SETUP', '2FA enrollment started', req.ip);
        res.json({
            secret,
            otpauth_uri: totpProvisioningUri(secret, req.admin.username || `admin-${req.admin.id}`)
        });
    } catch (error) {
        console.error('2FA setup error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/2fa/enable - confirm enrollment by submitting a live code
// from the authenticator app. The account is locked out of 2FA-free logins
// only after this succeeds, so a broken scan cannot trap the admin.
app.post('/api/admin/2fa/enable', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const { code } = req.body || {};
        if (!isText(code, 10)) return res.status(400).json({ error: 'Enter the 6-digit code from your authenticator app' });

        let adminId = req.admin.id;
        let username = req.admin.username;
        // Setup may have stored the secret on a different row if the account
        // was re-created; always read the current row before verifying.
        const [rows] = await db.query('SELECT totp_secret, totp_enabled FROM admins WHERE id = ?', [adminId]);
        if (rows.length === 0) return res.status(500).json({ error: 'Admin row not found' });
        const { totp_secret, totp_enabled } = rows[0];
        if (!totp_secret) return res.status(400).json({ error: 'Run setup first (scan the QR/secret), then confirm with a code' });
        if (totp_enabled) return res.json({ success: true, message: 'Two-factor authentication is already enabled' });
        if (!totpVerify(totp_secret, code)) {
            await createAuditLog(adminId, '2FA_ENABLE_FAILED', 'Wrong code while enabling 2FA', req.ip);
            return res.status(401).json({ error: 'That code did not match. Check the app and try again.' });
        }
        await db.query('UPDATE admins SET totp_enabled = 1 WHERE id = ?', [adminId]);
        await createAuditLog(adminId, '2FA_ENABLED', '2FA enrollment confirmed', req.ip);
        res.json({ success: true, message: 'Two-factor authentication is now enabled' });
    } catch (error) {
        console.error('2FA enable error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/2fa/disable - turn 2FA off. CSRF-protected like every other
// state change; the audit row keeps a record of when it was dropped.
app.post('/api/admin/2fa/disable', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        await db.query('UPDATE admins SET totp_enabled = 0, totp_secret = NULL WHERE id = ?', [req.admin.id]);
        await createAuditLog(req.admin.id, '2FA_DISABLED', '2FA turned off', req.ip);
        res.json({ success: true, message: 'Two-factor authentication disabled' });
    } catch (error) {
        console.error('2FA disable error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/admin/logout - clear the admin session cookie
app.post('/api/admin/logout', csrfValidate, (req, res) => {
    res.clearCookie('admin_token', { ...buildCookieOptions(req), maxAge: undefined });
    res.json({ success: true, message: 'Logged out successfully' });
});

app.post('/api/admin/forgot-password', resetLimiter, csrfValidate, async (req, res) => {
    try {
        const { email } = req.body || {};
        if (!isText(email, 254) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'A valid email is required' });
        }
        const [admins] = await db.query('SELECT id, username FROM admins WHERE email = ?', [email]);
        // Same answer whether or not the address belongs to an admin: the old
        // two different messages were a clean account-enumeration oracle.
        const genericMessage = 'If that email exists, we sent a reset link.';
        if (admins.length === 0) {
            return res.json({ success: true, message: genericMessage });
        }
        const admin = admins[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
        // Store only a SHA-256 hash; the raw token exists only in the emailed link
        const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        await db.query('UPDATE admins SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [resetTokenHash, tokenExpiry, admin.id]);
        const frontendUrl = process.env.FRONTEND_URL;
        // The token goes in the URL *fragment*, not the query string: fragments
        // are never forwarded to the page's own scripts by a proxy, never logged
        // by the server and never leaked in a Referer header when the page then
        // loads an asset from another origin.
        const resetLink = `${frontendUrl}/reset-password#token=${resetToken}`;
        // Fire and forget: awaiting SMTP for existing addresses but not for
        // missing ones was a timing oracle. sendEmail() logs and swallows its
        // own failures, so nothing is lost by returning immediately.
        sendEmail(email, 'Password Reset Request', `<p>Click <a href="${resetLink}">here</a> to reset your password. Link expires in 1 hour.</p>`);
        res.json({ success: true, message: genericMessage });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/reset-password', resetUseLimiter, csrfValidate, async (req, res) => {
    try {
        const { token, newPassword } = req.body || {};
        if (!isText(token, 128) || !isText(newPassword, 200)) {
            return res.status(400).json({ error: 'Token and new password (min 10 chars) required' });
        }
        const passwordError = passwordProblem(newPassword);
        if (passwordError) return res.status(400).json({ error: passwordError });
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const [admins] = await db.query('SELECT id FROM admins WHERE reset_token = ? AND reset_token_expires > NOW()', [tokenHash]);
        if (admins.length === 0) return res.status(400).json({ error: 'Invalid or expired token' });
        const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        // One-time token, cleared lockout state, and bump token_version so every
        // JWT issued before this reset stops working - that is how a stolen
        // session dies once the password is changed.
        const revoke = adminTokenVersionReady
            ? ', token_version = token_version + 1'
            : '';
        await db.query(
            `UPDATE admins
             SET password = ?, reset_token = NULL, reset_token_expires = NULL,
                 failed_attempts = 0, locked_until = NULL${revoke}
             WHERE id = ?`,
            [hashedPassword, admins[0].id]
        );
        await createAuditLog(admins[0].id, 'PASSWORD_RESET', 'Password reset via emailed token', req.ip);
        res.json({ success: true, message: 'Password reset successfully. You can now login.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

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
    if (!adminTokenVersionReady) return true;
    try {
        const [rows] = await db.query('SELECT token_version FROM admins WHERE id = ?', [decoded.id]);
        return rows.length > 0 && rows[0].token_version === (decoded.tv || 0);
    } catch (error) {
        return false;
    }
};

app.post('/api/admin/setup', setupLimiter, csrfValidate, async (req, res) => {
    // Accept either env name: .env.example documented ADMIN_SETUP_SECRET while
    // the code read ADMIN_SETUP_KEY, and a deployment that set the documented
    // one silently got a 404.
    const setupKey = process.env.ADMIN_SETUP_KEY || process.env.ADMIN_SETUP_SECRET;
    const providedHeader = req.headers['x-setup-secret'];
    if (!setupKey) {
        // Return 404 so the endpoint doesn't even register as existing when the key is unset
        return res.status(404).json({ error: 'Not found' });
    }
    if (!isText(providedHeader, 512)) {
        return res.status(401).json({ error: 'Setup token required' });
    }
    const keyBuffer = Buffer.from(setupKey, 'utf8');
    const headerBuffer = Buffer.from(providedHeader, 'utf8');
    if (keyBuffer.length !== headerBuffer.length || !crypto.timingSafeEqual(keyBuffer, headerBuffer)) {
        return res.status(401).json({ error: 'Invalid setup token' });
    }
    try {
        const { username, password, email } = req.body || {};
        if (!isText(username, 60) || !isText(password, 200) || !isText(email, 254)) {
            return res.status(400).json({ error: 'Username, password, and email required' });
        }
        const passwordError = passwordProblem(password);
        if (passwordError) {
            return res.status(400).json({ error: passwordError });
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'A valid email is required' });
        }

        // This route used to be a permanent master key: with the right header it
        // could overwrite any admin's password, forever, and log the real owner
        // out. It now only bootstraps the first account. Changing an existing
        // account needs an already-authenticated admin session, or the operator
        // explicitly flipping ADMIN_SETUP_ALLOW_OVERWRITE=true for recovery.
        const [existing] = await db.query('SELECT 1 FROM admins LIMIT 1');
        if (existing.length > 0) {
            const recoveryMode = process.env.ADMIN_SETUP_ALLOW_OVERWRITE === 'true';
            if (!recoveryMode && !(await hasAdminSession(req))) {
                return res.status(403).json({
                    error: 'Admin accounts already exist. Log in first, or temporarily set ADMIN_SETUP_ALLOW_OVERWRITE=true to recover access.'
                });
            }
        }

        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        const bump = adminTokenVersionReady ? ', token_version = token_version + 1' : '';
        await db.query(
            `INSERT INTO admins (username, password, email) VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE password = ?, email = ?${bump}`,
            [username, hashedPassword, email, hashedPassword, email]
        );
        await createAuditLog(null, 'ADMIN_SETUP', `Setup wrote admin account: ${username}`, req.ip);
        res.json({ success: true, message: 'Admin saved. Previous sessions were invalidated; use the new credentials to login.' });
    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/teachers', verifyAdmin, csrfValidate, [
    body('name').isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('department').isLength({ min: 2, max: 100 }).withMessage('Department must be 2-100 characters'),
    body('image_url').optional().isURL().withMessage('Image URL must be a valid URL')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const { name, department, image_url } = req.body;
        const sanitizedName = name.trim().slice(0, 200);
        const sanitizedDept = await canonicalDepartment(department);
        if (sanitizedDept.length < 2) return res.status(400).json({ error: 'Department must be 2-100 characters' });
        const sanitizedImageUrl = image_url ? image_url.trim().slice(0, 500) : null;
        const [result] = await db.query('INSERT INTO teachers (name, department, image_url) VALUES (?, ?, ?)', [sanitizedName, sanitizedDept, sanitizedImageUrl]);
        await createAuditLog(req.admin.id, 'ADD_TEACHER', `Added teacher: ${sanitizedName}`, req.ip);
        invalidateCache('teachers');
        res.json({ success: true, id: result.insertId, message: 'Teacher added successfully' });
    } catch (error) {
        console.error('Error adding teacher:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/admin/teachers/:id', verifyAdmin, csrfValidate, async (req, res) => {
    const teacherId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(teacherId) || teacherId < 1) {
        return res.status(400).json({ error: 'Invalid teacher ID' });
    }

    let connection;
    try {
        connection = await db.getConnection();
        await connection.beginTransaction();

        const [teachers] = await connection.query('SELECT name FROM teachers WHERE id = ?', [teacherId]);
        if (teachers.length === 0) {
            await connection.rollback();
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // Q&A and review reports deliberately have no foreign key (the column
        // types differ across deployments), so they must be removed explicitly
        // or they linger as rows nothing can ever display or delete.
        if (reviewReportsReady) {
            await connection.query(
                'DELETE rr FROM review_reports rr JOIN reviews r ON r.id = rr.review_id WHERE r.teacher_id = ?',
                [teacherId]
            );
        }
        await connection.query('DELETE FROM reviews WHERE teacher_id = ?', [teacherId]);
        await connection.query(
            `DELETE qa FROM question_answers qa
             JOIN questions q ON q.id = qa.question_id
             WHERE q.teacher_id = ?`,
            [teacherId]
        );
        await connection.query('DELETE FROM questions WHERE teacher_id = ?', [teacherId]);
        await connection.query('DELETE FROM teachers WHERE id = ?', [teacherId]);

        await connection.commit();

        await createAuditLog(req.admin.id, 'DELETE_TEACHER', `Deleted teacher: ${teachers[0].name || teacherId}`, req.ip);
        invalidateCache('teachers');
        res.json({ success: true, message: 'Teacher deleted successfully' });
    } catch (error) {
        if (connection) {
            try { await connection.rollback(); } catch (rollbackErr) { /* already gone */ }
        }
        console.error('Error deleting teacher:', error);
        res.status(500).json({ error: 'Database error' });
    } finally {
        if (connection) connection.release();
    }
});

// ========== GET TEACHER DETAILS (admin only) — full info + ALL reviews ==========
app.get('/api/admin/teachers/:id', verifyAdmin, async (req, res) => {
    try {
        const teacherId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(teacherId) || teacherId < 1) {
            return res.status(400).json({ error: 'Invalid teacher ID' });
        }

        const [teachers] = await db.query('SELECT * FROM teachers WHERE id = ?', [teacherId]);
        if (teachers.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // ALL reviews (approved + pending) — admins see everything
        const reportSelect = reviewReportsReady
            ? `, (SELECT COUNT(*) FROM review_reports rr WHERE rr.review_id = r.id AND rr.status = 'open') AS open_reports`
            : '';
        const [reviews] = await db.query(
            `SELECT r.*, t.name as teacher_name${reportSelect}
             FROM reviews r
             JOIN teachers t ON r.teacher_id = t.id
             WHERE r.teacher_id = ?
             ORDER BY (r.moderation_flag = 'sensitive') DESC, (r.moderation_flag = 'bias') DESC, r.created_at DESC`,
            [teacherId]
        );

        const approved = reviews.filter(r => r.is_approved === 1).length;
        const pending = reviews.filter(r => r.is_approved === 0).length;

        // Q&A stats for this teacher
        let questionCount = 0;
        try {
            const [qRows] = await db.query(
                'SELECT COUNT(*) as total FROM questions WHERE teacher_id = ? AND is_approved = 1',
                [teacherId]
            );
            questionCount = qRows[0].total || 0;
        } catch (e) { /* table may not exist yet */ }

        res.json({
            teacher: teachers[0],
            reviews: reviews,
            stats: {
                total_reviews: reviews.length,
                approved_reviews: approved,
                pending_reviews: pending,
                questions: questionCount
            }
        });
    } catch (error) {
        console.error('Error fetching admin teacher details:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== UPDATE TEACHER (admin only) ==========
app.put('/api/admin/teachers/:id', verifyAdmin, csrfValidate, [
    body('name').isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('department').isLength({ min: 2, max: 100 }).withMessage('Department must be 2-100 characters'),
    body('image_url').optional().isURL().withMessage('Image URL must be a valid URL')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }

    try {
        const teacherId = req.params.id;
        const { name, department, image_url } = req.body;
        const sanitizedName = name.trim().slice(0, 200);
        const sanitizedDept = await canonicalDepartment(department);
        if (sanitizedDept.length < 2) return res.status(400).json({ error: 'Department must be 2-100 characters' });
        const sanitizedImageUrl = image_url ? image_url.trim().slice(0, 500) : null;

        // Check if teacher exists
        const [existing] = await db.query('SELECT id FROM teachers WHERE id = ?', [teacherId]);
        if (existing.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        await db.query(
            'UPDATE teachers SET name = ?, department = ?, image_url = ? WHERE id = ?',
            [sanitizedName, sanitizedDept, sanitizedImageUrl, teacherId]
        );

        await createAuditLog(req.admin.id, 'UPDATE_TEACHER', `Updated teacher: ${sanitizedName} (ID: ${teacherId})`, req.ip);

        invalidateCache('teachers');
        res.json({
            success: true,
            message: 'Teacher updated successfully'
        });
    } catch (error) {
        console.error('Error updating teacher:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/admin/clean-teacher-images – clear unusable teacher photo URLs.
// Some imported rows hold a bare directory URL with no filename, which renders
// as a broken image instead of the initials avatar. Pass ?dryRun=true to
// preview what would be cleared without changing anything.
app.post('/api/admin/clean-teacher-images', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const dryRun = String(req.query.dryRun) === 'true' || (req.body && req.body.dryRun === true);

        const [rows] = await db.query('SELECT id, image_url FROM teachers WHERE image_url IS NOT NULL');
        const unusable = rows.filter((row) => !isUsableTeacherImageUrl(row.image_url));

        const blank = unusable.filter((row) => !(row.image_url || '').trim()).length;
        const broken = unusable.length - blank;

        if (unusable.length === 0) {
            return res.json({
                success: true,
                cleaned: 0,
                broken: 0,
                blank: 0,
                message: 'No unusable image URLs found'
            });
        }

        if (dryRun) {
            return res.json({
                success: true,
                dryRun: true,
                wouldClean: unusable.length,
                broken,
                blank,
                sample: unusable.slice(0, 25).map((row) => ({ id: row.id, image_url: row.image_url }))
            });
        }

        const ids = unusable.map((row) => row.id);

        // Chunked + explicit placeholders so we never rely on driver-specific
        // array expansion for `IN (?)`.
        let updated = 0;
        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const chunk = ids.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => '?').join(',');
            const [result] = await db.query(
                `UPDATE teachers SET image_url = NULL WHERE id IN (${placeholders})`,
                chunk
            );
            updated += result.affectedRows || 0;
        }

        await createAuditLog(
            req.admin.id,
            'CLEAN_TEACHER_IMAGES',
            `Cleared ${ids.length} unusable image URLs (${broken} broken, ${blank} blank)`,
            req.ip
        );
        invalidateCache('teachers');

        res.json({
            success: true,
            cleaned: updated,
            broken,
            blank,
            message: `Cleared ${updated} unusable teacher photo URL${updated === 1 ? '' : 's'}`
        });
    } catch (error) {
        console.error('Error cleaning teacher image URLs:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/admin/reviews', verifyAdmin, async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
        const offset = (page - 1) * limit;

        // Optional moderation filter: ?pending=1 returns only unapproved
        // rows (used by the dashboard "pending" counter click-through).
        const pendingOnly = req.query.pending === '1' || req.query.pending === 'true';
        const whereClause = pendingOnly ? 'WHERE r.is_approved = 0' : '';
        const reportSelect = reviewReportsReady
            ? `, (SELECT COUNT(*) FROM review_reports rr WHERE rr.review_id = r.id AND rr.status = 'open') AS open_reports`
            : '';

        const [reviews] = await db.query(`
            SELECT r.*, t.name as teacher_name${reportSelect}
            FROM reviews r
            JOIN teachers t ON r.teacher_id = t.id
            ${whereClause}
            ORDER BY (r.moderation_flag = 'sensitive') DESC, (r.moderation_flag = 'bias') DESC, r.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `);

        const [countResult] = pendingOnly
            ? await db.query('SELECT COUNT(*) as total FROM reviews WHERE is_approved = 0')
            : await db.query('SELECT COUNT(*) as total FROM reviews');
        const total = countResult[0].total;

        res.json({
            reviews: reviews,
            pagination: {
                page: page,
                limit: limit,
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching reviews:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/admin/reviews/:id', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const reviewId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(reviewId) || reviewId < 1) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }
        if (reviewReportsReady) {
            await db.query('DELETE FROM review_reports WHERE review_id = ?', [reviewId]);
        }
        const [result] = await db.query('DELETE FROM reviews WHERE id = ?', [reviewId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Review not found' });
        await createAuditLog(req.admin.id, 'DELETE_REVIEW', `Deleted review ID: ${reviewId}`, req.ip);
        // Without this the public review_count stays cached for up to 60s.
        invalidateCache('teachers');
        res.json({ success: true, message: 'Review deleted successfully' });
    } catch (error) {
        console.error('Error deleting review:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// PUT /api/admin/reviews/:id - edit a review (admin only)
// Accepts optional is_approved field to toggle approval status.
// When is_approved is omitted, only comment/user_name are updated (existing behavior).
app.put('/api/admin/reviews/:id', verifyAdmin, csrfValidate, [
    body('comment').optional().isLength({ min: 3, max: 1000 }).withMessage('Comment must be 3-1000 characters'),
    body('user_name').optional().isLength({ max: 100 }).withMessage('Name too long'),
    body('is_approved').optional().isBoolean().withMessage('is_approved must be a boolean')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const reviewId = req.params.id;
        const { comment, user_name, is_approved } = req.body;
        const sanitizedComment = comment ? comment.trim().slice(0, 1000) : undefined;
        const sanitizedName = user_name ? user_name.trim().slice(0, 100) : undefined;

        // Check if review exists
        const [existing] = await db.query('SELECT id FROM reviews WHERE id = ?', [reviewId]);
        if (existing.length === 0) return res.status(404).json({ error: 'Review not found' });

        // Build the update query dynamically
        const updates = [];
        const updateVals = [];
        if (sanitizedComment !== undefined) {
            updates.push('comment = ?');
            updateVals.push(sanitizedComment);
        }
        if (sanitizedName !== undefined) {
            updates.push('user_name = ?');
            updateVals.push(sanitizedName);
        }
        if (is_approved !== undefined) {
            updates.push('is_approved = ?');
            // Coerce to 0/1 so the TINYINT column never depends on driver
            // boolean stringification.
            updateVals.push(is_approved ? 1 : 0);
        }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        await db.query(`UPDATE reviews SET ${updates.join(', ')} WHERE id = ?`, [...updateVals, reviewId]);
        await createAuditLog(req.admin.id, is_approved !== undefined ? is_approved ? 'APPROVE_REVIEW' : 'REJECT_REVIEW' : 'EDIT_REVIEW', `Review ID: ${reviewId} ${is_approved !== undefined ? is_approved ? 'approved' : 'rejected' : 'edited'}`, req.ip);
        // Approval changes review_count on the public list; drop the cached copy.
        invalidateCache('teachers');
        res.json({ success: true, message: is_approved !== undefined ? (is_approved ? 'Review approved' : 'Review rejected') : 'Review updated successfully' });
    } catch (error) {
        console.error('Error editing review:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/admin/filter-reviews - run the NLP content filter over ALL
// existing reviews (?dryRun=true previews without changing anything).
// Flagged approved reviews are queued (is_approved = 0); nothing is ever
// auto-approved, so manually held reviews stay held.
app.post('/api/admin/filter-reviews', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const dryRun = String(req.query.dryRun) === 'true' || (req.body && req.body.dryRun === true);
        const result = await sweepExistingReviews(db, { dryRun });
        if (!dryRun) {
            if (result.toQueue > 0) invalidateCache('teachers');
            // An explicit run also satisfies the one-time boot sweep.
            reviewSweepDone = true;
            await createAuditLog(
                req.admin.id,
                'SWEEP_REVIEWS',
                // Same JSON shape as the startup sweep marker so
                // GET /api/admin/stats can parse either record.
                JSON.stringify({ scanned: result.scanned, queued: result.toQueue, alreadyQueued: result.alreadyQueued }),
                req.ip
            );
        }
        const { flaggedIds, ...summary } = result;
        res.json({
            success: true,
            ...summary,
            flaggedIdCount: flaggedIds.length,
            flaggedIds: flaggedIds.slice(0, 100)
        });
    } catch (error) {
        console.error('Error filtering existing reviews:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/admin/filter-qa - run the NLP content filter over existing
// questions, answers and custom course suggestions (?dryRun=true to
// preview). Flagged approved rows are queued; nothing is auto-approved.
app.post('/api/admin/filter-qa', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const dryRun = String(req.query.dryRun) === 'true' || (req.body && req.body.dryRun === true);
        const result = await sweepExistingQa(db, { dryRun });
        if (!dryRun) {
            qaSweepDone = true;
            await createAuditLog(
                req.admin.id,
                'SWEEP_QA',
                JSON.stringify({
                    questions: result.questions.toQueue,
                    answers: result.answers.toQueue,
                    courses: result.courses.toDemote
                }),
                req.ip
            );
        }
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Error filtering Q&A content:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/admin/questions - list questions (admin only)
app.get('/api/admin/questions', verifyAdmin, async (req, res) => {
    try {
        const page = clampInt(req.query.page, 1, 1, 100000);
        const limit = clampInt(req.query.limit, 50, 1, 100);
        const offset = (page - 1) * limit;

        const [questions] = await db.query(`
            SELECT q.*, t.name as teacher_name,
                   (SELECT COUNT(*) FROM question_answers a WHERE a.question_id = q.id) as answer_count
            FROM questions q
            JOIN teachers t ON q.teacher_id = t.id
            ORDER BY q.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `);

        const [countResult] = await db.query('SELECT COUNT(*) as total FROM questions');
        const total = countResult[0].total;

        // Attach answers (with approval state) so the admin Q&A tab can
        // moderate them inline.
        const questionIds = questions.map((q) => q.id);
        const answersByQuestion = {};
        if (questionIds.length > 0) {
            const placeholders = questionIds.map(() => '?').join(',');
            const [answers] = await db.query(
                `SELECT id, question_id, answer, is_approved, created_at FROM question_answers WHERE question_id IN (${placeholders}) ORDER BY created_at ASC`,
                questionIds
            );
            for (const answer of answers) {
                if (!answersByQuestion[answer.question_id]) answersByQuestion[answer.question_id] = [];
                answersByQuestion[answer.question_id].push(answer);
            }
        }
        questions.forEach((q) => { q.answers = answersByQuestion[q.id] || []; });

        res.json({
            questions: questions,
            pagination: {
                page: page,
                limit: limit,
                total: total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching questions:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// DELETE /api/admin/questions/:id - delete a question and its answers (admin only)
app.delete('/api/admin/questions/:id', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const questionId = req.params.id;
        await db.query('DELETE FROM question_answers WHERE question_id = ?', [questionId]);
        const [result] = await db.query('DELETE FROM questions WHERE id = ?', [questionId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Question not found' });
        await createAuditLog(req.admin.id, 'DELETE_QUESTION', `Deleted question ID: ${questionId}`, req.ip);
        res.json({ success: true, message: 'Question deleted successfully' });
    } catch (error) {
        console.error('Error deleting question:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// PUT /api/admin/questions/:id - approve/reject (or edit) a question (admin only)
app.put('/api/admin/questions/:id', verifyAdmin, csrfValidate, [
    body('question').optional().isLength({ min: 3, max: 500 }).withMessage('Question must be 3-500 characters'),
    body('is_approved').optional().isBoolean().withMessage('is_approved must be a boolean')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const questionId = req.params.id;
        const { question, is_approved } = req.body;
        const sanitizedQuestion = question !== undefined ? String(question).trim().slice(0, 1000) : undefined;

        const [existing] = await db.query('SELECT id FROM questions WHERE id = ?', [questionId]);
        if (existing.length === 0) return res.status(404).json({ error: 'Question not found' });

        const updates = [];
        const updateVals = [];
        if (sanitizedQuestion !== undefined) {
            updates.push('question = ?');
            updateVals.push(sanitizedQuestion);
        }
        if (is_approved !== undefined) {
            updates.push('is_approved = ?');
            updateVals.push(is_approved ? 1 : 0);
        }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

        await db.query(`UPDATE questions SET ${updates.join(', ')} WHERE id = ?`, [...updateVals, questionId]);
        const action = is_approved === undefined ? 'EDIT_QUESTION' : (is_approved ? 'APPROVE_QUESTION' : 'REJECT_QUESTION');
        await createAuditLog(req.admin.id, action, `Question ID: ${questionId}`, req.ip);
        res.json({
            success: true,
            message: is_approved === undefined ? 'Question updated' : (is_approved ? 'Question approved' : 'Question rejected')
        });
    } catch (error) {
        console.error('Error updating question:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// PUT /api/admin/answers/:id - approve/reject (or edit) an answer (admin only)
app.put('/api/admin/answers/:id', verifyAdmin, csrfValidate, [
    body('answer').optional().isLength({ min: 1, max: 500 }).withMessage('Answer must be 1-500 characters'),
    body('is_approved').optional().isBoolean().withMessage('is_approved must be a boolean')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const answerId = req.params.id;
        const { answer, is_approved } = req.body;
        const sanitizedAnswer = answer !== undefined ? String(answer).trim().slice(0, 1000) : undefined;

        const [existing] = await db.query('SELECT id FROM question_answers WHERE id = ?', [answerId]);
        if (existing.length === 0) return res.status(404).json({ error: 'Answer not found' });

        const updates = [];
        const updateVals = [];
        if (sanitizedAnswer !== undefined) {
            updates.push('answer = ?');
            updateVals.push(sanitizedAnswer);
        }
        if (is_approved !== undefined) {
            updates.push('is_approved = ?');
            updateVals.push(is_approved ? 1 : 0);
        }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

        await db.query(`UPDATE question_answers SET ${updates.join(', ')} WHERE id = ?`, [...updateVals, answerId]);
        const action = is_approved === undefined ? 'EDIT_ANSWER' : (is_approved ? 'APPROVE_ANSWER' : 'REJECT_ANSWER');
        await createAuditLog(req.admin.id, action, `Answer ID: ${answerId}`, req.ip);
        res.json({
            success: true,
            message: is_approved === undefined ? 'Answer updated' : (is_approved ? 'Answer approved' : 'Answer rejected')
        });
    } catch (error) {
        console.error('Error updating answer:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// DELETE /api/admin/answers/:id - remove an answer permanently (admin only)
app.delete('/api/admin/answers/:id', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const answerId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(answerId) || answerId < 1) {
            return res.status(400).json({ error: 'Invalid answer ID' });
        }
        const [result] = await db.query('DELETE FROM question_answers WHERE id = ?', [answerId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Answer not found' });

        await createAuditLog(req.admin.id, 'DELETE_ANSWER', `Deleted answer ID: ${answerId}`, req.ip);
        res.json({ success: true, message: 'Answer deleted successfully' });
    } catch (error) {
        console.error('Error deleting answer:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/admin/reviews/bulk - approve or reject many reviews at once
app.post('/api/admin/reviews/bulk', verifyAdmin, csrfValidate, [
    body('ids').isArray({ min: 1, max: 500 }).withMessage('ids must be a non-empty array'),
    body('action').isIn(['approve', 'reject']).withMessage("action must be 'approve' or 'reject'")
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const { ids, action } = req.body;
        const cleanIds = [...new Set(ids.map((id) => parseInt(id, 10)).filter((id) => id > 0))];
        if (cleanIds.length === 0) return res.status(400).json({ error: 'No valid review ids' });

        const placeholders = cleanIds.map(() => '?').join(',');
        const approved = action === 'approve' ? 1 : 0;
        const [result] = await db.query(
            `UPDATE reviews SET is_approved = ? WHERE id IN (${placeholders})`,
            [approved, ...cleanIds]
        );
        await createAuditLog(
            req.admin.id,
            action === 'approve' ? 'BULK_APPROVE_REVIEWS' : 'BULK_REJECT_REVIEWS',
            `${result.affectedRows} review(s) set to ${approved}`,
            req.ip
        );
        invalidateCache('teachers');
        res.json({ success: true, updated: result.affectedRows });
    } catch (error) {
        console.error('Error in bulk review update:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== CUSTOM COURSES (community-added, admin-approved) ==========
// POST /api/custom-courses – student suggests a custom course for admin approval
app.post('/api/custom-courses', questionLimiter, [
    body('name').trim().isLength({ min: 2, max: 200 }).withMessage('Course name must be 2-200 characters')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
    try {
        const name = req.body.name.trim().replace(/\s+/g, ' ');
        const nameKey = name.toLowerCase();

        // NLP content filter: a flagged suggestion never auto-approves,
        // regardless of how often an approved name was reused before.
        const flagged = detectFlaggedText(name).flagged;

        // Already approved as a custom course? Just bump its usage counter.
        const [approved] = await db.query(
            "SELECT id FROM custom_courses WHERE name_key = ? AND status = 'approved'",
            [nameKey]
        );
        if (!flagged && approved.length > 0) {
            await db.query('UPDATE custom_courses SET times_used = times_used + 1 WHERE id = ?', [approved[0].id]);
            return res.json({ success: true, status: 'approved' });
        }

        // Upsert by case-insensitive key: first use -> pending, reuse -> bump counter
        await db.query(
            `INSERT INTO custom_courses (name, name_key, status) VALUES (?, ?, 'pending')
             ON DUPLICATE KEY UPDATE times_used = times_used + 1`,
            [name, nameKey]
        );
        res.json({ success: true, status: 'pending', pending: flagged });
    } catch (error) {
        console.error('Error suggesting custom course:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/custom-courses – approved custom courses (public, for review form dropdown)
app.get('/api/custom-courses', async (req, res) => {
    try {
        const [rows] = await db.query(
            "SELECT name FROM custom_courses WHERE status = 'approved' ORDER BY name ASC"
        );
        res.set('Cache-Control', 'public, max-age=300');
        res.json({ courses: rows.map(r => r.name) });
    } catch (error) {
        console.error('Error fetching custom courses:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/admin/custom-courses – full list for the admin dashboard
app.get('/api/admin/custom-courses', verifyAdmin, async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id, name, status, times_used, created_at, reviewed_at FROM custom_courses ORDER BY (status = \'pending\') DESC, times_used DESC, name ASC'
    );
        res.json({ courses: rows });
    } catch (error) {
        console.error('Error fetching admin custom courses:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// PUT /api/admin/custom-courses/:id – approve or reject (admin only)
app.put('/api/admin/custom-courses/:id', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const courseId = req.params.id;
        const action = req.body.action; // 'approve' | 'reject'
        if (!['approve', 'reject'].includes(action)) {
            return res.status(400).json({ error: 'Invalid action' });
        }
        const [result] = await db.query(
            "UPDATE custom_courses SET status = ?, reviewed_at = NOW() WHERE id = ?",
            [action === 'approve' ? 'approved' : 'rejected', courseId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Course not found' });
        await createAuditLog(req.admin.id, action === 'approve' ? 'APPROVE_COURSE' : 'REJECT_COURSE', `Custom course ID: ${courseId}`, req.ip);
        res.json({ success: true, message: `Course ${action}d successfully` });
    } catch (error) {
        console.error('Error updating custom course:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== READER REPORTS (admin) ==========
// The public report button used to write rows that no endpoint ever read, so
// reports could only be counted. These two routes let a moderator see the
// reason and close it out.

app.get('/api/admin/reports', verifyAdmin, async (req, res) => {
    const page = clampInt(req.query.page, 1, 1, 100000);
    const limit = clampInt(req.query.limit, 50, 1, 100);
    const offset = (page - 1) * limit;

    if (!reviewReportsReady) {
        return res.json({
            reports: [],
            pagination: { page, limit, total: 0, totalPages: 1 },
            available: false
        });
    }

    const status = ['open', 'resolved', 'dismissed'].includes(req.query.status) ? req.query.status : 'open';
    try {
        const [reports] = await db.query(`
            SELECT rr.id, rr.review_id, rr.reason, rr.status, rr.created_at,
                   r.comment, r.user_name, r.is_approved,
                   t.id AS teacher_id, t.name AS teacher_name
            FROM review_reports rr
            JOIN reviews r ON r.id = rr.review_id
            JOIN teachers t ON t.id = r.teacher_id
            WHERE rr.status = ?
            ORDER BY rr.created_at DESC
            LIMIT ? OFFSET ?
        `, [status, limit, offset]);

        const [countResult] = await db.query(
            'SELECT COUNT(*) as total FROM review_reports WHERE status = ?',
            [status]
        );
        const total = countResult[0].total || 0;

        res.json({
            reports,
            pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
            available: true
        });
    } catch (error) {
        console.error('Error fetching review reports:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// PUT /api/admin/reports/:id - close a report (or reopen it)
app.put('/api/admin/reports/:id', verifyAdmin, csrfValidate, [
    body('status').isIn(['open', 'resolved', 'dismissed']).withMessage('Invalid report status')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    if (!reviewReportsReady) {
        return res.status(503).json({ error: 'Reporting is temporarily unavailable.' });
    }

    const reportId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(reportId) || reportId < 1) {
        return res.status(400).json({ error: 'Invalid report ID' });
    }

    try {
        const [result] = await db.query('UPDATE review_reports SET status = ? WHERE id = ?', [req.body.status, reportId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Report not found' });
        await createAuditLog(req.admin.id, 'REVIEW_REPORT', `Report ${reportId} marked ${req.body.status}`, req.ip);
        res.json({ success: true, message: `Report ${req.body.status}` });
    } catch (error) {
        console.error('Error updating review report:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
    try {
        const [teacherCount] = await db.query('SELECT COUNT(*) as count FROM teachers');
        const [reviewCount] = await db.query('SELECT COUNT(*) as count FROM reviews');
        const [recentReviews] = await db.query('SELECT COUNT(*) as count FROM reviews WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)');
        const [pendingCount] = await db.query('SELECT COUNT(*) as count FROM reviews WHERE is_approved = 0');

        // Latest NLP filter sweep record (audit_logs row written by the
        // one-time startup sweep or POST /api/admin/filter-reviews).
        // Non-fatal: stats still work if audit_logs has no sweep row yet.
        let last_sweep = null;
        try {
            const [sweepRows] = await db.query(
                "SELECT details, created_at FROM audit_logs WHERE action = 'SWEEP_REVIEWS' ORDER BY id DESC LIMIT 1"
            );
            if (sweepRows.length > 0) {
                const parsed = JSON.parse(sweepRows[0].details || '{}');
                last_sweep = {
                    scanned: Number(parsed.scanned) || 0,
                    queued: Number(parsed.queued) || 0,
                    already_queued: Number(parsed.alreadyQueued) || 0,
                    at: sweepRows[0].created_at
                };
            }
        } catch (sweepErr) {
            last_sweep = null;
        }

        // Open reader reports drive the badge on the Reports tab.
        let openReports = 0;
        if (reviewReportsReady) {
            try {
                const [reportCount] = await db.query("SELECT COUNT(*) as count FROM review_reports WHERE status = 'open'");
                openReports = reportCount[0].count || 0;
            } catch (reportErr) {
                openReports = 0;
            }
        }

        res.json({
            total_teachers: teacherCount[0].count,
            total_reviews: reviewCount[0].count,
            reviews_last_week: recentReviews[0].count,
            pending_reviews: pendingCount[0].count,
            open_reports: openReports,
            last_sweep
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/admin/audit-logs - newest moderation actions, paginated.
// Optional ?action= filters to one action type (the tab's filter dropdown
// offers the handful that actually recur). IPs are stored hashed (see
// hashIpForAudit) and are shown as-is: they correlate sessions, they do not
// identify a person.
app.get('/api/admin/audit-logs', verifyAdmin, async (req, res) => {
    try {
        const page = clampInt(req.query.page, 1, 1, 100000);
        const limit = clampInt(req.query.limit, 25, 1, 100);
        const offset = (page - 1) * limit;
        const action = typeof req.query.action === 'string' ? req.query.action.slice(0, 50) : '';

        const whereClause = action ? 'WHERE a.action = ?' : '';
        const params = action ? [action] : [];

        const [countRows] = await db.query(
            `SELECT COUNT(*) as total FROM audit_logs a ${whereClause}`,
            params
        );
        const total = countRows[0].total;

        const [rows] = await db.query(`
            SELECT a.id, a.action, a.details, a.ip_address, a.created_at,
                   ad.username as admin_username
            FROM audit_logs a
            LEFT JOIN admins ad ON ad.id = a.admin_id
            ${whereClause}
            ORDER BY a.id DESC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        res.json({
            logs: rows,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.max(1, Math.ceil(total / limit))
            }
        });
    } catch (error) {
        console.error('Error fetching audit logs:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/admin/search-gaps - the queries students typed that matched nobody
// in the directory. Ordered by how often the term recurred, newest evidence
// first; the point is deciding who to add next, not auditing individuals.
app.get('/api/admin/search-gaps', verifyAdmin, async (req, res) => {
    try {
        if (!searchGapsReady) {
            return res.json({ gaps: [] });
        }
        const [rows] = await db.query(`
            SELECT query, COUNT(*) as times, MAX(created_at) as last_seen
            FROM search_gaps
            GROUP BY query
            ORDER BY times DESC, last_seen DESC
            LIMIT 50
        `);
        res.json({ gaps: rows });
    } catch (error) {
        console.error('Error fetching search gaps:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== DYNAMIC SITEMAP.XML ==========
app.get('/sitemap.xml', async (req, res) => {
    try {
        // Real last-modified dates matter: stamping every URL with "today" on
        // every request teaches crawlers to ignore the field entirely.
        const [teachers] = await db.query(`
            SELECT t.id, t.created_at,
                   (SELECT MAX(r.created_at) FROM reviews r
                     WHERE r.teacher_id = t.id AND r.is_approved = 1) AS last_review
            FROM teachers t
            ORDER BY t.name
        `);
        const [departments] = await db.query(`
            SELECT department, MAX(created_at) AS last_added
            FROM teachers
            GROUP BY department
            ORDER BY department
        `);
        const [questionMeta] = await db.query(
            'SELECT MAX(created_at) AS last_question FROM questions WHERE is_approved = 1'
        );
        // Distinct courses mentioned in approved reviews — used for /course/:name pages.
        // Kept lightweight: simple distinct list from the JSON array column.
        const [courses] = await db.query(`
            SELECT DISTINCT TRIM(JSON_UNQUOTE(JSON_EXTRACT(c.name, '$')) ) AS name
            FROM (
                SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(courses, ',', n.n), ',', -1) AS name
                FROM reviews
                JOIN (
                    SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
                    UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
                    UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
                ) n
                WHERE is_approved = 1 AND courses IS NOT NULL AND courses != ''
                  AND LENGTH(courses) - LENGTH(REPLACE(courses, ',', '')) >= n.n - 1
            ) c
            WHERE TRIM(c.name) != ''
            ORDER BY c.name
            LIMIT 100
        `);
        const baseUrl = PUBLIC_SITE_URL;

        const asDate = (value) => {
            if (!value) return null;
            const date = value instanceof Date ? value : new Date(value);
            return Number.isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
        };
        const today = asDate(new Date());

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        const addUrl = (loc, lastmod, changefreq, priority) => {
            xml += `  <url>\n    <loc>${loc}</loc>\n`;
            if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
            xml += `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>\n`;
        };

        // Homepage
        addUrl(`${baseUrl}/`, today, 'daily', '1.0');

        // Static pages. /about has no route (it redirects to the homepage), so it
        // is intentionally absent. Legal pages have no real modification date.
        ['privacy', 'terms', 'dmca', 'contact'].forEach((page) => {
            addUrl(`${baseUrl}/${page}`, null, 'yearly', '0.3');
        });

        // Public Q&A board
        if (questionMeta[0]?.last_question) {
            addUrl(`${baseUrl}/questions`, asDate(questionMeta[0].last_question), 'daily', '0.6');
        }

        // Department pages
        departments.forEach((dept) => {
            addUrl(
                `${baseUrl}/department/${encodeURIComponent(dept.department)}`,
                asDate(dept.last_added),
                'weekly',
                '0.7'
            );
        });

        // Teacher pages: last approved review, or the row's creation date.
        teachers.forEach((teacher) => {
            addUrl(
                `${baseUrl}/teacher/${teacher.id}`,
                asDate(teacher.last_review || teacher.created_at),
                'weekly',
                '0.8'
            );
        });

        // Course pages: each distinct course gets a listing page.
        // Only include courses that have at least one teacher in the directory.
        if (courses.length > 0) {
            const [teachersWithCourses] = await db.query(`
                SELECT DISTINCT t.id, t.name
                FROM teachers t
                JOIN reviews r ON r.teacher_id = t.id AND r.is_approved = 1
                WHERE r.courses IS NOT NULL AND r.courses != ''
            `);
            const courseTeacherIds = new Set(teachersWithCourses.map((t) => t.id));
            const seen = [];
            courses.forEach((row) => {
                const name = String(row.name || '').trim();
                if (!name || name.length < 2 || seen.includes(name)) return;
                // Only include if there are actual teachers for it
                // (we check at render time; if empty the page is noindexed client-side)
                addUrl(
                    `${baseUrl}/course/${encodeURIComponent(name)}`,
                    today,
                    'weekly',
                    '0.5'
                );
                seen.push(name);
            });
        }

        xml += '</urlset>';

        res.set('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        console.error('Error generating sitemap:', error);
        res.status(500).send('Error generating sitemap');
    }
});

// ========== DYNAMIC ROBOTS.TXT ==========
app.get('/robots.txt', (req, res) => {
    const baseUrl = PUBLIC_SITE_URL;
    const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml
`;
    res.set('Content-Type', 'text/plain');
    res.send(robots);
});

// Health check: process liveness only, so a platform restart loop is not
// triggered by a transient database blip.
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Readiness: unlike /api/health, this touches the database. Point uptime
// monitors here so "server up but DB unreachable" is visible.
app.get('/api/ready', async (req, res) => {
    try {
        await Promise.race([
            db.query('SELECT 1'),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500))
        ]);
        res.json({ status: 'ready', timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(503).json({ status: 'unavailable', error: 'Database check failed' });
    }
});

// Unknown route: answer JSON like every other API response. Express' default
// page is HTML and echoes the requested path back into it.
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Anything that escapes a route's own try/catch. Logged in full for the
// operator, answered generically to the client: stack traces and driver
// messages reveal internals and must never cross the wire.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    console.error(`Unhandled error on ${req.method} ${req.path}:`, err);
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ error: 'Request body is not valid JSON' });
    }
    if (err.type === 'entity.too.large' || err.status === 413) {
        return res.status(413).json({ error: 'Request body is too large' });
    }
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: 'Server error' });
});

// Start server
const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints ready at http://localhost:${PORT}/api`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health\n`);
});

// Render sends SIGTERM before replacing an instance. Stop accepting requests,
// let in-flight ones finish, then close the MySQL pool instead of dropping
// connections mid-query.
const shutdown = (signal) => {
    console.log(`\n${signal} received - closing HTTP server...`);
    server.close(async () => {
        try {
            await db.end();
        } catch (error) {
            console.error('Error closing database pool:', error.message);
        }
        process.exit(0);
    });
    // Do not hang forever if a request refuses to finish.
    setTimeout(() => process.exit(1), 10000).unref();
};

['SIGTERM', 'SIGINT'].forEach((signal) => process.on(signal, () => shutdown(signal)));