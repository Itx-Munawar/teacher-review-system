// Admin audit log with hashed IPs.

const crypto = require('crypto');
const db = require('../db');
const { JWT_SECRET } = require('../config');
const { clampInt } = require('./validation');

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

module.exports = {
    hashIpForAudit,
    AUDIT_LOG_RETENTION_DAYS,
    pruneAuditLogs,
    createAuditLog
};
