// Admin account endpoints: login, session, 2FA, logout, password reset,
// first-run setup.

const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');
const { csrfValidate } = require('../csrf');
const state = require('../state');
const { BCRYPT_ROUNDS } = require('../config');
const { isText } = require('../lib/validation');
const { buildCookieOptions } = require('../lib/cookies');
const { loginLimiter, resetLimiter, setupLimiter, resetUseLimiter } = require('../lib/limiters');
const { sendEmail } = require('../lib/email');
const { generateTotpSecret, totpVerify, totpProvisioningUri } = require('../lib/totp');
const { signAdminToken, verifyAdmin, passwordProblem, DUMMY_HASH, hasAdminSession } = require('../lib/auth');
const { createAuditLog } = require('../lib/audit');

const router = express.Router();

// ========== ADMIN API ENDPOINTS ==========

router.post('/api/admin/login', loginLimiter, csrfValidate, async (req, res) => {
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
router.get('/api/admin/me', verifyAdmin, async (req, res) => {
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
router.post('/api/admin/2fa/setup', verifyAdmin, csrfValidate, async (req, res) => {
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
router.post('/api/admin/2fa/enable', verifyAdmin, csrfValidate, async (req, res) => {
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
router.post('/api/admin/2fa/disable', verifyAdmin, csrfValidate, async (req, res) => {
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
router.post('/api/admin/logout', csrfValidate, (req, res) => {
    res.clearCookie('admin_token', { ...buildCookieOptions(req), maxAge: undefined });
    res.json({ success: true, message: 'Logged out successfully' });
});

router.post('/api/admin/forgot-password', resetLimiter, csrfValidate, async (req, res) => {
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

router.post('/api/admin/reset-password', resetUseLimiter, csrfValidate, async (req, res) => {
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
        const revoke = state.adminTokenVersionReady
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

router.post('/api/admin/setup', setupLimiter, csrfValidate, async (req, res) => {
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
        const bump = state.adminTokenVersionReady ? ', token_version = token_version + 1' : '';
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

module.exports = router;
