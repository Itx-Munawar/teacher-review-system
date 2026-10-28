// Public endpoints: teachers, search, Q&A, reviews and review replies.

const express = require('express');
const db = require('../db');
// Public forms use the same double-submit CSRF check as the admin panel. It
// runs before the rate limiters, so a forged cross-site request is refused
// without spending the visitor's own review/question budget.
const { csrfValidate } = require('../csrf');
const { body, validationResult } = require('express-validator');
const { detectFlaggedText, moderationFlagFor } = require('../contentFilter');
const state = require('../state');
const { clampInt } = require('../lib/validation');
const { parseCookies } = require('../lib/cookies');
const { reviewLimiter, searchLimiter, questionLimiter, replyLimiter, voteLimiter, trackLimiter, clientErrorLimiter } = require('../lib/limiters');
const { recordSearchGap } = require('../lib/searchGaps');
const { getCached, setCache, invalidateCache } = require('../lib/cache');
const { normalizeReviewText } = require('../lib/content');
const crypto = require('crypto');
const { JWT_SECRET } = require('../config');
const { parseCourseList } = require('../contentFilter');
const { getTeacherSummary } = require('../lib/summaries');
const analytics = require('../lib/analytics');
const { recordError, isIgnored } = require('../lib/errorTracker');

const router = express.Router();

// Helpful votes are keyed on a random, HttpOnly per-browser id (not the IP:
// a whole campus shares one address). Only a keyed hash of it is stored.
const VOTER_COOKIE = 'vid';
const voterHashFor = (req) => {
    const id = parseCookies(req)[VOTER_COOKIE];
    if (!id || !/^[0-9a-f]{32}$/.test(id)) return null;
    return crypto.createHash('sha256').update(`vote|${id}|${JWT_SECRET}`).digest('hex');
};
const ensureVoterId = (req, res) => {
    let id = parseCookies(req)[VOTER_COOKIE];
    if (!id || !/^[0-9a-f]{32}$/.test(id)) {
        id = crypto.randomBytes(16).toString('hex');
        const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        res.cookie(VOTER_COOKIE, id, { httpOnly: true, secure, sameSite: 'lax', maxAge: 365 * 24 * 60 * 60 * 1000, path: '/' });
        req.headers.cookie = `${req.headers.cookie ? `${req.headers.cookie}; ` : ''}${VOTER_COOKIE}=${id}`;
    }
    return voterHashFor(req);
};

const REVIEW_MIN_CHARS = 5;
const REPLY_MIN_CHARS = 2;
const REPLY_MAX_CHARS = 500;

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

// GET /api/stats - headline numbers for the home page (cached 60s)
router.get('/api/stats', async (req, res) => {
    try {
        let stats = getCached('stats');
        if (!stats) {
            const [[row]] = await db.query(`
                SELECT
                    (SELECT COUNT(*) FROM teachers) AS teachers,
                    (SELECT COUNT(DISTINCT department) FROM teachers) AS departments,
                    (SELECT COUNT(*) FROM reviews WHERE is_approved = 1) AS reviews,
                    (SELECT COUNT(DISTINCT teacher_id) FROM reviews WHERE is_approved = 1) AS reviewed_teachers
            `);
            stats = {
                teachers: Number(row.teachers) || 0,
                departments: Number(row.departments) || 0,
                reviews: Number(row.reviews) || 0,
                reviewed_teachers: Number(row.reviewed_teachers) || 0,
            };
            setCache('stats', stats);
        }
        res.set('Cache-Control', 'public, max-age=60');
        res.json(stats);
    } catch (error) {
        console.error('Error fetching stats:', error);
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
        if (!analytics.isBot(req.get('user-agent'))) {
            analytics.trackSearch(term, teachers.length);
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
        // Optional ordering and course filter for the reviews list.
        // Default is "most helpful" (ties fall back to newest); ?review_sort=newest opts out.
        const reviewSort = req.query.review_sort !== 'newest' && state.reviewVotesReady ? 'helpful' : 'newest';
        const reviewCourse = typeof req.query.review_course === 'string' ? req.query.review_course.trim().slice(0, 200) : '';

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
        const courseWhere = reviewCourse ? ' AND r.courses LIKE ?' : '';
        const courseParams = reviewCourse ? [`%${reviewCourse.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`] : [];
        const orderBy = reviewSort === 'helpful'
            ? 'r.helpful_count DESC, r.created_at DESC, r.id DESC'
            : 'r.created_at DESC, r.id DESC';
        const [reviews] = await db.query(
            `SELECT r.id, r.teacher_id, r.comment, r.user_name, r.courses, r.is_approved, r.created_at${state.reviewVotesReady ? ', r.helpful_count' : ''}
             FROM reviews r
             WHERE r.teacher_id = ? AND r.is_approved = 1${courseWhere}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`,
            [teacherId, ...courseParams, reviewLimit, reviewOffset]
        );

        // Total for the current filter (drives pagination) and the overall total.
        const [countData] = await db.query(
            `SELECT COUNT(*) as total FROM reviews r WHERE r.teacher_id = ? AND r.is_approved = 1${courseWhere}`,
            [teacherId, ...courseParams]
        );
        const totalReviews = countData[0].total || 0;
        let allReviews = totalReviews;
        if (reviewCourse) {
            const [allCount] = await db.query('SELECT COUNT(*) as total FROM reviews WHERE teacher_id = ? AND is_approved = 1', [teacherId]);
            allReviews = allCount[0].total || 0;
        }

        // Course chips: every course mentioned across ALL approved reviews,
        // not just the loaded page, with how many reviews mention it.
        const [courseRows] = await db.query(
            "SELECT courses FROM reviews WHERE teacher_id = ? AND is_approved = 1 AND courses IS NOT NULL AND courses <> ''",
            [teacherId]
        );
        const courseMap = new Map();
        courseRows.forEach((row) => {
            const seen = new Set();
            parseCourseList(row.courses).forEach((course) => {
                const key = course.toLowerCase();
                if (seen.has(key)) return;
                seen.add(key);
                const entry = courseMap.get(key) || { course, count: 0 };
                entry.count += 1;
                courseMap.set(key, entry);
            });
        });
        const courseCounts = [...courseMap.values()]
            .sort((a, b) => b.count - a.count || a.course.localeCompare(b.course))
            .slice(0, 20);

        // Which of these reviews this browser already marked helpful.
        reviews.forEach((r) => {
            r.helpful_count = Number(r.helpful_count) || 0;
            r.voted = false;
        });
        const voterHash = voterHashFor(req);
        if (voterHash && state.reviewVotesReady && reviews.length > 0) {
            const [votes] = await db.query(
                `SELECT review_id FROM review_votes WHERE voter_hash = ? AND review_id IN (${reviews.map(() => '?').join(',')})`,
                [voterHash, ...reviews.map((r) => r.id)]
            );
            const votedIds = new Set(votes.map((v) => v.review_id));
            reviews.forEach((r) => { r.voted = votedIds.has(r.id); });
        }

        // Approved replies under each review on this page, oldest first, so a
        // thread reads top to bottom. Only public columns are selected.
        reviews.forEach((r) => { r.replies = []; });
        if (state.reviewRepliesReady && reviews.length > 0) {
            const ids = reviews.map((r) => r.id);
            const [replies] = await db.query(
                `SELECT id, review_id, reply, user_name, created_at
                 FROM review_replies
                 WHERE review_id IN (${ids.map(() => '?').join(',')}) AND is_approved = 1
                 ORDER BY created_at ASC, id ASC`,
                ids
            );
            const byReview = new Map(reviews.map((r) => [r.id, r]));
            replies.forEach((reply) => {
                const parent = byReview.get(reply.review_id);
                if (parent) parent.replies.push(reply);
            });
        }


        res.json({
            teacher: teachers[0],
            reviews: reviews,
            total_reviews: allReviews,
            filtered_reviews: totalReviews,
            review_sort: reviewSort,
            review_course: reviewCourse || null,
            course_counts: courseCounts,
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
router.post('/api/questions', csrfValidate, questionLimiter, [
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
router.post('/api/questions/:id/answers', csrfValidate, questionLimiter, [
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
router.post('/api/reviews', csrfValidate, reviewLimiter, [
    body('teacher_id').isInt({ min: 1 }).withMessage('Invalid teacher ID'),
    // Short reviews ("Very good", "Best sir") are allowed; a moderator reads
    // every review anyway. Bare "ok"/"bad" (under REVIEW_MIN_CHARS) are not.
    body('comment')
        .customSanitizer((value) => String(value || '').trim())
        .isLength({ min: REVIEW_MIN_CHARS, max: 1000 })
        .withMessage(`Review must be between ${REVIEW_MIN_CHARS} and 1000 characters`),
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
        // Punctuation alone ("!!!!!") passes the length check but says nothing.
        if (normalizedComment.replace(/\s/g, '').length < 2) {
            return res.status(400).json({
                error: `Review must be between ${REVIEW_MIN_CHARS} and 1000 characters`,
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

// POST /api/reviews/:id/replies - reply to a published review. Like reviews and
// Q&A answers, every reply waits for a moderator before it is shown.
router.post('/api/reviews/:id/replies', csrfValidate, replyLimiter, [
    body('reply')
        .customSanitizer((value) => (typeof value === 'string' ? value.trim() : ''))
        .isLength({ min: REPLY_MIN_CHARS, max: REPLY_MAX_CHARS })
        .withMessage(`Reply must be between ${REPLY_MIN_CHARS} and ${REPLY_MAX_CHARS} characters`),
    body('user_name').optional({ nullable: true }).isString().isLength({ max: 100 }).withMessage('Name too long')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, code: 'VALIDATION_ERROR' });
    }
    if (!state.reviewRepliesReady) {
        return res.status(503).json({ error: 'Replies are temporarily unavailable. Please try again shortly.' });
    }
    try {
        const reviewId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(reviewId) || reviewId < 1) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }
        const [reviews] = await db.query('SELECT id FROM reviews WHERE id = ? AND is_approved = 1', [reviewId]);
        if (reviews.length === 0) return res.status(404).json({ error: 'Review not found' });

        const reply = req.body.reply.replace(/[ \t]+/g, ' ').slice(0, REPLY_MAX_CHARS);
        const normalized = normalizeReviewText(reply);
        if (normalized.replace(/\s/g, '').length < 2) {
            return res.status(400).json({ error: `Reply must be between ${REPLY_MIN_CHARS} and ${REPLY_MAX_CHARS} characters`, code: 'VALIDATION_ERROR' });
        }
        const rawName = typeof req.body.user_name === 'string' ? req.body.user_name.trim().slice(0, 100) : '';
        const userName = rawName || 'Anonymous';

        // The same text twice under one review is a double-tap or spam.
        const [existing] = await db.query('SELECT reply FROM review_replies WHERE review_id = ? ORDER BY id DESC LIMIT 100', [reviewId]);
        if (existing.some((row) => normalizeReviewText(row.reply) === normalized)) {
            return res.status(409).json({ error: 'This reply has already been submitted.', code: 'DUPLICATE_REPLY' });
        }

        const flag = moderationFlagFor(reply) || (detectFlaggedText(userName).flagged ? 'profanity' : null);
        const [result] = await db.query(
            'INSERT INTO review_replies (review_id, reply, user_name, is_approved, moderation_flag) VALUES (?, ?, ?, 0, ?)',
            [reviewId, reply, userName, flag]
        );
        res.json({
            success: true,
            reply_id: result.insertId,
            pending: true,
            message: 'Reply submitted - it will appear once a moderator approves it.'
        });
    } catch (error) {
        console.error('Error saving reply:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST/DELETE /api/reviews/:id/helpful - mark (or unmark) a review helpful.
const helpfulVote = (add) => async (req, res) => {
    if (!state.reviewVotesReady) return res.status(503).json({ error: 'Voting is temporarily unavailable.' });
    try {
        const reviewId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(reviewId) || reviewId < 1) return res.status(400).json({ error: 'Invalid review ID' });
        const [reviews] = await db.query('SELECT id FROM reviews WHERE id = ? AND is_approved = 1', [reviewId]);
        if (reviews.length === 0) return res.status(404).json({ error: 'Review not found' });

        const voterHash = ensureVoterId(req, res);
        if (add) {
            const [result] = await db.query('INSERT IGNORE INTO review_votes (review_id, voter_hash) VALUES (?, ?)', [reviewId, voterHash]);
            if (result.affectedRows > 0) await db.query('UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = ?', [reviewId]);
        } else {
            const [result] = await db.query('DELETE FROM review_votes WHERE review_id = ? AND voter_hash = ?', [reviewId, voterHash]);
            if (result.affectedRows > 0) await db.query('UPDATE reviews SET helpful_count = GREATEST(helpful_count, 1) - 1 WHERE id = ?', [reviewId]);
        }
        const [[row]] = await db.query('SELECT helpful_count FROM reviews WHERE id = ?', [reviewId]);
        res.json({ success: true, voted: add, helpful_count: Number(row.helpful_count) || 0 });
    } catch (error) {
        console.error('Error saving helpful vote:', error);
        res.status(500).json({ error: 'Database error' });
    }
};
router.post('/api/reviews/:id/helpful', csrfValidate, voteLimiter, helpfulVote(true));
router.delete('/api/reviews/:id/helpful', csrfValidate, voteLimiter, helpfulVote(false));

// GET /api/teachers/:id/summary - AI summary of the approved reviews (Roman Urdu)
router.get('/api/teachers/:id/summary', async (req, res) => {
    try {
        const teacherId = Number.parseInt(req.params.id, 10);
        if (!Number.isInteger(teacherId) || teacherId < 1) return res.status(400).json({ error: 'Invalid teacher ID' });
        const summary = await getTeacherSummary(teacherId);
        if (summary.reason === 'not_found') return res.status(404).json({ error: 'Teacher not found' });
        // A fresh summary may be cached briefly; failures must not be.
        res.set('Cache-Control', summary.available && !summary.stale ? 'public, max-age=300' : 'no-store');
        res.json(summary);
    } catch (error) {
        console.error('Error loading teacher summary:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/track - anonymous counters: { type: 'visit' } once per browser
// session, { type: 'teacher_view', teacher_id } once per profile per session.
router.post('/api/track', csrfValidate, trackLimiter, async (req, res) => {
    if (analytics.isBot(req.get('user-agent'))) return res.status(204).end();
    const type = req.body && req.body.type;
    if (type === 'visit') {
        await analytics.trackVisit();
        return res.status(204).end();
    }
    if (type === 'teacher_view') {
        const teacherId = Number.parseInt(req.body.teacher_id, 10);
        if (!Number.isInteger(teacherId) || teacherId < 1) return res.status(400).json({ error: 'Invalid teacher ID' });
        await analytics.trackTeacherView(teacherId);
        return res.status(204).end();
    }
    return res.status(400).json({ error: 'Unknown event type' });
});

// POST /api/client-errors - JavaScript errors from the browser.
router.post('/api/client-errors', csrfValidate, clientErrorLimiter, async (req, res) => {
    const body = req.body || {};
    const message = typeof body.message === 'string' ? body.message.slice(0, 500) : '';
    if (!message) return res.status(400).json({ error: 'message is required' });
    const stack = typeof body.stack === 'string' ? body.stack.slice(0, 6000) : '';
    if (isIgnored(message, stack) || analytics.isBot(req.get('user-agent'))) return res.status(204).end();
    let path = null;
    if (typeof body.url === 'string') {
        try { path = new URL(body.url, 'https://x.invalid').pathname.slice(0, 300); } catch (_) { path = null; }
    }
    await recordError({ source: 'frontend', message, stack, path, method: null, userAgent: req.get('user-agent') || null });
    res.status(204).end();
});

module.exports = router;
