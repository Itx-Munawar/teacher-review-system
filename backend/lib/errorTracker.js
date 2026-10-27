// Built-in error tracking: backend and browser errors are grouped by a
// fingerprint into error_logs, listed in the admin panel, and new ones are
// emailed to the operator (at most one email per hour).

const crypto = require('crypto');
const { AsyncLocalStorage } = require('async_hooks');
const db = require('../db');
const state = require('../state');
const { PUBLIC_SITE_URL } = require('../config');
const { logJson } = require('./log');

const ALERT_RECIPIENT = () => (process.env.ERROR_ALERT_EMAIL || process.env.MODERATION_DIGEST_EMAIL || process.env.EMAIL_USER || '').trim();
const ALERT_INTERVAL_MS = 60 * 60 * 1000;
const RETENTION_DAYS = 30;
// The same fingerprint is written at most this often; repeats in between are
// counted in memory and flushed with the next write.
const WRITE_THROTTLE_MS = 10 * 1000;

// Browser noise that is not our bug: extensions, cross-origin scripts with no
// detail, and benign layout warnings.
const IGNORED_MESSAGES = [
    /^Script error\.?$/i,
    /ResizeObserver loop/i,
    /chrome-extension:|moz-extension:|safari-extension:/i,
    /Non-Error promise rejection captured/i,
    /Load failed$/i,
    /^Network Error$/i,
    /Failed to fetch dynamically imported module/i,
    /Importing a module script failed/i,
];

const isIgnored = (message, stack = '') => IGNORED_MESSAGES.some((re) => re.test(message) || re.test(stack));

// Numbers, ids and hex blobs vary between occurrences of the same bug.
const normaliseForFingerprint = (text) => String(text || '')
    .replace(/0x[0-9a-f]+/gi, 'X')
    .replace(/[0-9a-f]{16,}/gi, 'H')
    .replace(/\d+/g, 'N')
    .slice(0, 300);

const firstFrame = (stack) => {
    const lines = String(stack || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('at ') || l.includes('@'));
    return lines.length ? lines[0].replace(/:\d+:\d+\)?$/, '') : '';
};

const fingerprintFor = (source, message, stack) => crypto
    .createHash('sha1')
    .update(`${source}|${normaliseForFingerprint(message)}|${normaliseForFingerprint(firstFrame(stack))}`)
    .digest('hex');

const pendingCounts = new Map(); // fingerprint -> { lastWrite, extra }
let recording = false; // re-entrancy guard: a failing insert must not recurse

/**
 * Store one error occurrence. Never throws and never logs through the hooked
 * console.error (that would loop).
 */
const recordError = async ({ source = 'backend', message, stack = '', path = null, method = null, userAgent = null } = {}) => {
    const msg = String(message || 'Unknown error').replace(/\s+/g, ' ').trim().slice(0, 500);
    const stk = String(stack || '').slice(0, 6000);
    if (!msg || isIgnored(msg, stk)) return null;
    if (!state.errorLogsReady || recording) return null;

    const fingerprint = fingerprintFor(source, msg, stk);
    const now = Date.now();
    const entry = pendingCounts.get(fingerprint);
    if (entry && now - entry.lastWrite < WRITE_THROTTLE_MS) {
        entry.extra += 1;
        return fingerprint;
    }
    const extra = entry ? entry.extra : 0;
    pendingCounts.set(fingerprint, { lastWrite: now, extra: 0 });
    if (pendingCounts.size > 500) pendingCounts.clear();

    recording = true;
    try {
        const [result] = await db.query(
            `INSERT INTO error_logs (fingerprint, source, message, stack, path, method, user_agent, occurrences)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                occurrences = occurrences + VALUES(occurrences),
                last_seen = CURRENT_TIMESTAMP,
                stack = VALUES(stack),
                path = COALESCE(VALUES(path), path),
                method = COALESCE(VALUES(method), method),
                user_agent = COALESCE(VALUES(user_agent), user_agent),
                alerted_at = IF(resolved = 1, NULL, alerted_at),
                resolved = 0`,
            [
                fingerprint,
                String(source).slice(0, 16),
                msg,
                stk || null,
                path ? String(path).slice(0, 300) : null,
                method ? String(method).slice(0, 10) : null,
                userAgent ? String(userAgent).slice(0, 300) : null,
                1 + extra
            ]
        );
        // affectedRows 1 = brand new fingerprint (or a resolved one came back).
        if (result.affectedRows === 1) scheduleAlert();
        return fingerprint;
    } catch (err) {
        logJson('warn', 'error_tracker_write_failed', { reason: String(err && err.message) });
        return null;
    } finally {
        recording = false;
    }
};

// ---------- email alerts ----------
let alertTimer = null;
let alertInFlight = false;

const scheduleAlert = () => {
    if (alertTimer || !ALERT_RECIPIENT()) return;
    // Wait a minute so a burst of related errors lands in one email.
    alertTimer = setTimeout(() => {
        alertTimer = null;
        sendErrorAlerts().catch(() => {});
    }, Number(process.env.ERROR_ALERT_DELAY_MS) || 60 * 1000);
    if (alertTimer.unref) alertTimer.unref();
};

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const sendErrorAlerts = async () => {
    const to = ALERT_RECIPIENT();
    if (!to || !state.errorLogsReady || alertInFlight) return { sent: false, reason: 'unavailable' };
    alertInFlight = true;
    try {
        // At most one alert email per hour, across restarts.
        const [recent] = await db.query(
            "SELECT 1 FROM audit_logs WHERE action = 'ERROR_ALERT_SENT' AND created_at >= DATE_SUB(NOW(), INTERVAL ? SECOND) LIMIT 1",
            [Math.floor(ALERT_INTERVAL_MS / 1000)]
        );
        if (recent.length > 0) {
            // Try again when the window has passed.
            setTimeout(() => sendErrorAlerts().catch(() => {}), ALERT_INTERVAL_MS).unref();
            return { sent: false, reason: 'throttled' };
        }
        const [rows] = await db.query(
            `SELECT id, source, message, path, method, occurrences, last_seen
             FROM error_logs WHERE resolved = 0 AND alerted_at IS NULL
             ORDER BY last_seen DESC LIMIT 20`
        );
        if (rows.length === 0) return { sent: false, reason: 'nothing_new' };

        const { sendEmail } = require('./email');
        const html = `
            <h2 style="margin:0 0 12px">${rows.length} new error${rows.length === 1 ? '' : 's'} on Teacher Reviews</h2>
            <table cellpadding="6" style="border-collapse:collapse;font-family:sans-serif;font-size:13px">
                <tr><th align="left">Where</th><th align="left">Message</th><th align="right">Count</th></tr>
                ${rows.map((r) => `<tr>
                    <td style="border-bottom:1px solid #eee;white-space:nowrap">${escapeHtml(r.source)}${r.path ? `<br><small>${escapeHtml(r.method || '')} ${escapeHtml(r.path)}</small>` : ''}</td>
                    <td style="border-bottom:1px solid #eee">${escapeHtml(r.message)}</td>
                    <td style="border-bottom:1px solid #eee;text-align:right">${r.occurrences}</td>
                </tr>`).join('')}
            </table>
            <p><a href="${PUBLIC_SITE_URL}/admin">Open the admin panel → Errors</a></p>
            <p style="color:#888;font-size:12px">You get at most one of these emails per hour. Resolve errors in the panel to be alerted again if they come back.</p>
        `;
        const ok = await sendEmail(to, `⚠️ ${rows.length} new error${rows.length === 1 ? '' : 's'} on Teacher Reviews`, html);
        if (!ok) return { sent: false, reason: 'email_failed' };
        await db.query(`UPDATE error_logs SET alerted_at = NOW() WHERE id IN (${rows.map(() => '?').join(',')})`, rows.map((r) => r.id));
        await db.query("INSERT INTO audit_logs (action, details, ip_address) VALUES ('ERROR_ALERT_SENT', ?, 'system')", [String(rows.length)]);
        return { sent: true, count: rows.length };
    } catch (err) {
        logJson('warn', 'error_alert_failed', { reason: String(err && err.message) });
        return { sent: false, reason: 'error' };
    } finally {
        alertInFlight = false;
    }
};

const pruneErrorLogs = async () => {
    if (!state.errorLogsReady) return;
    try {
        await db.query('DELETE FROM error_logs WHERE last_seen < DATE_SUB(NOW(), INTERVAL ? DAY)', [RETENTION_DAYS]);
    } catch (err) {
        logJson('warn', 'error_prune_failed', { reason: String(err && err.message) });
    }
};

// ---------- hooks ----------
let installed = false;

// Remembers which request is being served, so an error logged deep inside a
// route's catch block is stored with its method and path.
const requestStore = new AsyncLocalStorage();
const requestContext = (req, res, next) => {
    requestStore.run({ path: req.originalUrl ? req.originalUrl.split('?')[0] : req.path, method: req.method, userAgent: req.get('user-agent') || null }, next);
};

/**
 * Route handlers already call console.error(msg, err) in their catch blocks,
 * so hooking it captures every handled 500 without touching each route.
 */
const installProcessHooks = () => {
    if (installed) return;
    installed = true;
    const original = console.error.bind(console);
    console.error = (...args) => {
        original(...args);
        if (recording) return;
        const err = args.find((a) => a instanceof Error);
        if (!err) return;
        const label = args.filter((a) => typeof a === 'string').join(' ').replace(/[:\s]+$/, '').slice(0, 200);
        const message = label ? `${label}: ${err.message}` : err.message;
        const ctx = requestStore.getStore() || {};
        recordError({ source: 'backend', message, stack: err.stack, path: ctx.path, method: ctx.method, userAgent: ctx.userAgent }).catch(() => {});
    };

    process.on('unhandledRejection', (reason) => {
        const err = reason instanceof Error ? reason : new Error(String(reason));
        original('Unhandled promise rejection:', err);
        recordError({ source: 'backend', message: `Unhandled rejection: ${err.message}`, stack: err.stack }).catch(() => {});
    });

    process.on('uncaughtException', (err) => {
        original('Uncaught exception:', err);
        // State may be corrupt: record, then exit and let Render restart us.
        const done = () => process.exit(1);
        recordError({ source: 'backend', message: `Uncaught exception: ${err && err.message}`, stack: err && err.stack })
            .finally(() => setTimeout(done, 200));
        setTimeout(done, 3000).unref();
    });
};

module.exports = {
    recordError,
    sendErrorAlerts,
    pruneErrorLogs,
    installProcessHooks,
    requestContext,
    fingerprintFor,
    isIgnored,
};
