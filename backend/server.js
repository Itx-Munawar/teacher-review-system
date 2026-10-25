require('dotenv').config();
// Entry point: validates config, starts the HTTP server, kicks off
// background jobs and handles graceful shutdown.

// config must load first: it exits with a clear message if env vars are missing.
const { PORT } = require('./config');
const app = require('./app');
const db = require('./db');
const { pruneAuditLogs } = require('./lib/audit');
const { pruneSearchGaps } = require('./lib/searchGaps');
const { sendModerationDigest } = require('./jobs/digest');
const { ensureTables } = require('./jobs/schema');

// Start server
const server = app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints ready at http://localhost:${PORT}/api`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health\n`);
});

// ========== BACKGROUND JOBS ==========
ensureTables();
// Render instances can stay up for weeks, so prune on a timer as well as on
// boot. unref() keeps the timer from holding the process open.
setInterval(pruneAuditLogs, 24 * 60 * 60 * 1000).unref();
setInterval(pruneSearchGaps, 24 * 60 * 60 * 1000).unref();
// Hourly check; the marker row makes it a at-most-once-per-day digest.
setInterval(() => sendModerationDigest(), 60 * 60 * 1000).unref();
// Give the schema bootstrap a moment on cold start, then try once today.
setTimeout(() => sendModerationDigest(), 90 * 1000).unref();

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
