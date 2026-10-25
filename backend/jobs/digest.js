// Daily moderation digest email.

const db = require('../db');
const { PUBLIC_SITE_URL } = require('../config');
const { logJson } = require('../lib/log');
const { sendEmail } = require('../lib/email');

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

module.exports = {
    DIGEST_RECIPIENT,
    sendModerationDigest
};
