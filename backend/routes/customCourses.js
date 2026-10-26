// Community-suggested course names (public submit, admin approval).

const express = require('express');
const db = require('../db');
const { body, validationResult } = require('express-validator');
const { csrfValidate } = require('../csrf');
const { detectFlaggedText } = require('../contentFilter');
const { questionLimiter } = require('../lib/limiters');
const { verifyAdmin } = require('../lib/auth');
const { createAuditLog } = require('../lib/audit');

const router = express.Router();

// ========== CUSTOM COURSES (community-added, admin-approved) ==========
// POST /api/custom-courses – student suggests a custom course for admin approval
router.post('/api/custom-courses', csrfValidate, questionLimiter, [
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
router.get('/api/custom-courses', async (req, res) => {
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
router.get('/api/admin/custom-courses', verifyAdmin, async (req, res) => {
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
router.put('/api/admin/custom-courses/:id', verifyAdmin, csrfValidate, async (req, res) => {
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

module.exports = router;
