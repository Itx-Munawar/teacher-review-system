// Public endpoints: teachers, search, Q&A, reviews and reports.

const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { body, validationResult } = require('express-validator');
const { detectFlaggedText, moderationFlagFor } = require('../contentFilter');
const state = require('../state');
const { JWT_SECRET } = require('../config');
const { clampInt } = require('../lib/validation');
const { parseCookies } = require('../lib/cookies');
const { reviewLimiter, searchLimiter, questionLimiter, reportLimiter } = require('../lib/limiters');
const { createAuditLog } = require('../lib/audit');
const { recordSearchGap } = require('../lib/searchGaps');
const { getCached, setCache, invalidateCache } = require('../lib/cache');
const { normalizeReviewText } = require('../lib/content');

const router = express.Router();

// ========== PUBLIC API ENDPOINTS ==========

// GET /api/teachers - paginated list (20 per page by default)
// Supports: ?page=N&limit=20..200&sort=name|reviews|newest&department=<name>&course=<name>
router.get('/api/teachers', async (req, res) => {
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
router.get('/api/departments', async (req, res) => {
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
router.get('/api/teachers/search', searchLimiter, async (req, res) => {
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
        if (teachers.length === 0 && state.searchGapsReady) {
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
router.get('/api/teachers/:id', async (req, res) => {
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
router.get('/api/teachers/:id/related', async (req, res) => {
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


router.get('/api/teachers/:id/questions', async (req, res) => {
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
router.get('/api/questions', async (req, res) => {
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
router.post('/api/questions', questionLimiter, [
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
router.post('/api/questions/:id/answers', questionLimiter, [
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
router.post('/api/reviews', reviewLimiter, [
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
        if (state.reviewModerationColumnReady) {
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
router.post('/api/reviews/:id/report', reportLimiter, [
    body('reason')
        .customSanitizer((value) => String(value || '').trim())
        .isLength({ min: 3, max: 300 })
        .withMessage('Please give a short reason (3-300 characters)')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, code: 'VALIDATION_ERROR' });
    }

    if (!state.reviewReportsReady) {
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

module.exports = router;
