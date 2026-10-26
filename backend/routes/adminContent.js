// Admin moderation: teachers, reviews, questions and answers.

const express = require('express');
const db = require('../db');
const { body, validationResult } = require('express-validator');
const { csrfValidate } = require('../csrf');
const { sweepExistingReviews, sweepExistingQa } = require('../contentFilter');
const state = require('../state');
const { clampInt } = require('../lib/validation');
const { verifyAdmin } = require('../lib/auth');
const { createAuditLog } = require('../lib/audit');
const { invalidateCache } = require('../lib/cache');
const { isUsableTeacherImageUrl, canonicalDepartment, normalizeTeacherName } = require('../lib/content');

const router = express.Router();

router.post('/api/admin/teachers', verifyAdmin, csrfValidate, [
    body('name').isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('department').isLength({ min: 2, max: 100 }).withMessage('Department must be 2-100 characters'),
    body('image_url').optional().isURL().withMessage('Image URL must be a valid URL')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const { name, department, image_url } = req.body;
        const sanitizedName = normalizeTeacherName(name).slice(0, 100);
        if (sanitizedName.length < 2) return res.status(400).json({ error: 'Name must be 2-100 characters' });
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

router.delete('/api/admin/teachers/:id', verifyAdmin, csrfValidate, async (req, res) => {
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
        if (state.reviewReportsReady) {
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
router.get('/api/admin/teachers/:id', verifyAdmin, async (req, res) => {
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
        const reportSelect = state.reviewReportsReady
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
router.put('/api/admin/teachers/:id', verifyAdmin, csrfValidate, [
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
        const sanitizedName = normalizeTeacherName(name).slice(0, 100);
        if (sanitizedName.length < 2) return res.status(400).json({ error: 'Name must be 2-100 characters' });
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
router.post('/api/admin/clean-teacher-images', verifyAdmin, csrfValidate, async (req, res) => {
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

router.get('/api/admin/reviews', verifyAdmin, async (req, res) => {
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
        const offset = (page - 1) * limit;

        // Optional moderation filter: ?pending=1 returns only unapproved
        // rows (used by the dashboard "pending" counter click-through).
        const pendingOnly = req.query.pending === '1' || req.query.pending === 'true';
        const whereClause = pendingOnly ? 'WHERE r.is_approved = 0' : '';
        const reportSelect = state.reviewReportsReady
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

router.delete('/api/admin/reviews/:id', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const reviewId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(reviewId) || reviewId < 1) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }
        if (state.reviewReportsReady) {
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
router.put('/api/admin/reviews/:id', verifyAdmin, csrfValidate, [
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
router.post('/api/admin/filter-reviews', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const dryRun = String(req.query.dryRun) === 'true' || (req.body && req.body.dryRun === true);
        const result = await sweepExistingReviews(db, { dryRun });
        if (!dryRun) {
            if (result.toQueue > 0) invalidateCache('teachers');
            // An explicit run also satisfies the one-time boot sweep.
            state.reviewSweepDone = true;
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
router.post('/api/admin/filter-qa', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const dryRun = String(req.query.dryRun) === 'true' || (req.body && req.body.dryRun === true);
        const result = await sweepExistingQa(db, { dryRun });
        if (!dryRun) {
            state.qaSweepDone = true;
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
router.get('/api/admin/questions', verifyAdmin, async (req, res) => {
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
router.delete('/api/admin/questions/:id', verifyAdmin, csrfValidate, async (req, res) => {
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
router.put('/api/admin/questions/:id', verifyAdmin, csrfValidate, [
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
router.put('/api/admin/answers/:id', verifyAdmin, csrfValidate, [
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
router.delete('/api/admin/answers/:id', verifyAdmin, csrfValidate, async (req, res) => {
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
router.post('/api/admin/reviews/bulk', verifyAdmin, csrfValidate, [
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

module.exports = router;
