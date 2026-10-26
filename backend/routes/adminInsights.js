// Admin read-outs: reader reports, stats, audit log, search gaps.

const express = require('express');
const db = require('../db');
const { body, validationResult } = require('express-validator');
const { csrfValidate } = require('../csrf');
const state = require('../state');
const { clampInt } = require('../lib/validation');
const { verifyAdmin } = require('../lib/auth');
const { createAuditLog } = require('../lib/audit');

const router = express.Router();

// ========== READER REPORTS (admin) ==========
// The public report button used to write rows that no endpoint ever read, so
// reports could only be counted. These two routes let a moderator see the
// reason and close it out.

router.get('/api/admin/reports', verifyAdmin, async (req, res) => {
    const page = clampInt(req.query.page, 1, 1, 100000);
    const limit = clampInt(req.query.limit, 50, 1, 100);
    const offset = (page - 1) * limit;

    if (!state.reviewReportsReady) {
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
router.put('/api/admin/reports/:id', verifyAdmin, csrfValidate, [
    body('status').isIn(['open', 'resolved', 'dismissed']).withMessage('Invalid report status')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    if (!state.reviewReportsReady) {
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

router.get('/api/admin/stats', verifyAdmin, async (req, res) => {
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
        if (state.reviewReportsReady) {
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
router.get('/api/admin/audit-logs', verifyAdmin, async (req, res) => {
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
router.get('/api/admin/search-gaps', verifyAdmin, async (req, res) => {
    try {
        if (!state.searchGapsReady) {
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

// ========== REVIEW ASSISTANT (admin) ==========
// Usage counters (no question text) plus the answers students rated, worst
// first, so a moderator can see what the assistant is asked and gets wrong.

router.get('/api/admin/chat/insights', verifyAdmin, async (req, res) => {
    const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    if (!state.chatUsageReady) return res.json({ available: false, days });
    try {
        const since = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const [rows] = await db.query(
            'SELECT DATE_FORMAT(day, \'%Y-%m-%d\') AS day, metric, mkey, count FROM chat_usage_daily WHERE day >= ?',
            [since]
        );
        const sum = (metric) => {
            const totals = {};
            rows.filter((r) => r.metric === metric).forEach((r) => { totals[r.mkey] = (totals[r.mkey] || 0) + Number(r.count); });
            return totals;
        };
        const top = (metric, limit) => Object.entries(sum(metric))
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
            .slice(0, limit)
            .map(([key, count]) => ({ key, count }));

        const perDay = {};
        rows.filter((r) => r.metric === 'request' && (r.mkey === 'answered' || r.mkey === 'cached'))
            .forEach((r) => { perDay[r.day] = (perDay[r.day] || 0) + Number(r.count); });
        const byDay = [];
        for (let i = days - 1; i >= 0; i -= 1) {
            const day = new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
            byDay.push({ day, questions: perDay[day] || 0 });
        }

        const teacherCounts = top('teacher', 10);
        const ids = teacherCounts.map((t) => Number(t.key)).filter((n) => Number.isInteger(n) && n > 0);
        const names = new Map();
        if (ids.length) {
            const [teachers] = await db.query(`SELECT id, name, department FROM teachers WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
            teachers.forEach((t) => names.set(String(t.id), t));
        }

        const [ratingRows] = await db.query(
            'SELECT rating, COUNT(*) AS n FROM chat_feedback WHERE created_at >= ? GROUP BY rating',
            [since]
        );
        const ratings = { up: 0, down: 0 };
        ratingRows.forEach((r) => { if (Number(r.rating) === 1) ratings.up = Number(r.n); else ratings.down = Number(r.n); });

        const [feedback] = await db.query(
            `SELECT id, rating, question, answer, teacher_ids, comment, created_at, updated_at
             FROM chat_feedback WHERE created_at >= ?
             ORDER BY rating ASC, updated_at DESC LIMIT 100`,
            [since]
        );
        const feedbackTeacherIds = [...new Set(feedback.flatMap((f) => String(f.teacher_ids || '').split(',').filter(Boolean).map(Number)))]
            .filter((id) => !names.has(String(id)));
        if (feedbackTeacherIds.length) {
            const [more] = await db.query(`SELECT id, name, department FROM teachers WHERE id IN (${feedbackTeacherIds.map(() => '?').join(',')})`, feedbackTeacherIds);
            more.forEach((t) => names.set(String(t.id), t));
        }

        res.set('Cache-Control', 'no-store');
        res.json({
            available: true,
            days,
            requests: sum('request'),
            byDay,
            modes: sum('mode'),
            languages: sum('lang'),
            aspects: sum('aspect'),
            models: sum('model'),
            topTeachers: teacherCounts.map(({ key, count }) => ({
                id: Number(key),
                name: names.get(key)?.name || `Teacher #${key} (deleted)`,
                department: names.get(key)?.department || '',
                count
            })),
            topTopics: top('topic', 10).map(({ key, count }) => ({ name: key, count })),
            ratings,
            feedback: feedback.map((f) => ({
                id: f.id,
                rating: Number(f.rating),
                question: f.question,
                answer: f.answer,
                comment: f.comment,
                created_at: f.created_at,
                updated_at: f.updated_at,
                teachers: String(f.teacher_ids || '').split(',').filter(Boolean)
                    .map((id) => names.get(id)).filter(Boolean)
                    .map((t) => ({ id: t.id, name: t.name }))
            }))
        });
    } catch (error) {
        console.error('Chat insights error:', error);
        res.status(500).json({ error: 'Could not load assistant insights' });
    }
});

router.delete('/api/admin/chat/feedback/:id', verifyAdmin, csrfValidate, async (req, res) => {
    const id = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid id' });
    if (!state.chatUsageReady) return res.status(404).json({ error: 'Not found' });
    try {
        const [result] = await db.query('DELETE FROM chat_feedback WHERE id = ?', [id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Not found' });
        await createAuditLog(req.admin.id, 'DELETE_CHAT_FEEDBACK', `Deleted assistant rating #${id}`, req.ip);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete chat feedback error:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
