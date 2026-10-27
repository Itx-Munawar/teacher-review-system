// Express application: security middleware, CORS, logging, routes and
// error handlers. server.js imports it and starts listening.

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { csrfSetCookie } = require('./csrf');
const { logJson } = require('./lib/log');
const { installProcessHooks, requestContext } = require('./lib/errorTracker');

// Capture handled 500s (console.error in route catch blocks) and crashes.
installProcessHooks();

const app = express();

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
app.use(requestContext);
app.use(express.json({ limit: '100kb' }));

// CSRF: set cookie on every response so the frontend can read it
app.use(csrfSetCookie);

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

// ========== ROUTES ==========
// Mounted in the same order the routes were originally declared.
app.use(require('./routes/public'));
app.use(require('./routes/chat'));
app.use(require('./routes/adminAuth'));
app.use(require('./routes/adminContent'));
app.use(require('./routes/customCourses'));
app.use(require('./routes/adminInsights'));
app.use(require('./routes/seo'));
app.use(require('./routes/health'));

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
    // Malformed or oversized bodies are the client's mistake: one short line,
    // not a stack trace per junk request.
    if (err.type === 'entity.parse.failed') {
        console.warn(`Bad JSON body on ${req.method} ${req.path}`);
        return res.status(400).json({ error: 'Request body is not valid JSON' });
    }
    if (err.type === 'entity.too.large' || err.status === 413) {
        console.warn(`Oversized body on ${req.method} ${req.path}`);
        return res.status(413).json({ error: 'Request body is too large' });
    }
    console.error(`Unhandled error on ${req.method} ${req.path}:`, err);
    const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
    res.status(status).json({ error: 'Server error' });
});

module.exports = app;
