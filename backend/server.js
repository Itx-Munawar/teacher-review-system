require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./db');
const { csrfSetCookie, csrfValidate } = require('./csrf');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 10;

// ========== ENV VALIDATION ==========
const missingVars = [];
if (!JWT_SECRET) missingVars.push('JWT_SECRET');
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) missingVars.push('DB_*');
if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Server will not start. Fix the environment configuration and retry.');
    process.exit(1);
}
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.warn('⚠️ EMAIL_USER/EMAIL_PASS not set. Password reset emails will fail.');
}

// ========== COOKIE HELPERS (no extra dependency) ==========
const parseCookies = (req) => {
    const cookies = {};
    const header = req.headers.cookie;
    if (!header) return cookies;
    header.split(';').forEach((part) => {
        const idx = part.indexOf('=');
        if (idx === -1) return;
        cookies[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    });
    return cookies;
};

const buildCookieOptions = (req) => {
    // Derive from the actual request protocol (trust proxy is enabled),
    // not from NODE_ENV, so cross-site HTTPS deployments get SameSite=None.
    const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    return {
        httpOnly: true,
        secure,
        sameSite: secure ? 'none' : 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/'
    };
};

// Security Middleware
app.set('trust proxy', 1);
app.use(helmet());
const allowedOrigins = [
    'https://teacher-review-system-zeta.vercel.app',
    'http://localhost:3000'
];
app.use(cors({
    origin: (origin, cb) => {
        // Allow non-browser requests (curl, health checks) and known/monkeycode preview origins
        if (!origin) return cb(null, true);
        const allowed = allowedOrigins.includes(origin) || /^https:\/\/[\w-]+\.monkeycode-ai\.live$/.test(origin);
        cb(null, allowed);
    },
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));

// CSRF: set cookie on every response so the frontend can read it
app.use(csrfSetCookie);

// Rate limiting
const reviewLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many reviews. Please try again later.' }
});

const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many login attempts. Please try again later.' }
});

const searchLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    message: { error: 'Too many search requests. Please try again later.' }
});

const resetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    message: { error: 'Too many reset requests. Try again in an hour.' }
});

const questionLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { error: 'Too many questions. Please try again later.' }
});

// Email transporter
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

const sendEmail = async (to, subject, html) => {
    try {
        await transporter.sendMail({
            from: `"Teacher Reviews" <${process.env.EMAIL_USER}>`,
            to,
            subject,
            html
        });
        console.log(`✅ Email sent to ${to}`);
        return true;
    } catch (error) {
        console.error('❌ Email error:', error);
        return false;
    }
};

// ========== HELPER FUNCTIONS ==========
const verifyAdmin = (req, res, next) => {
    const cookies = parseCookies(req);
    const headerToken = req.headers.authorization?.split(' ')[1];
    const token = headerToken || cookies.admin_token;
    if (!token) return res.status(401).json({ error: 'No token provided' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.admin = decoded;
        next();
    } catch (error) {
        res.status(403).json({ error: 'Invalid token' });
    }
};

const createAuditLog = async (adminId, action, details, ip = 'unknown') => {
    try {
        await db.query(
            'INSERT INTO audit_logs (admin_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [adminId, action, details, ip]
        );
    } catch (error) {
        console.error('Audit log error:', error);
    }
};

// ========== IN-MEMORY CACHE ==========
const { LRUCache } = require('lru-cache');
const cache = new LRUCache({
    max: 500, // Maximum number of items in cache
    ttl: 60 * 1000, // 60 seconds
});

const getCached = (key) => {
    return cache.get(key) || null;
};

const setCache = (key, data) => {
    cache.set(key, data);
};

const invalidateCache = (pattern) => {
    for (const key of cache.keys()) {
        if (key.startsWith(pattern)) cache.delete(key);
    }
};

// ========== SCHEMA BOOTSTRAP ==========
// Creates tables that may be added after the initial deployment, so the
// server can auto-migrate on Render without manual SQL.
let schemaBootstrapError = null;
let schemaBootstrapDone = false;

const runSchemaBootstrap = async () => {
    try {
        await db.query(`
            CREATE TABLE IF NOT EXISTS questions (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                teacher_id INT NOT NULL,
                question TEXT NOT NULL,
                is_approved TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_questions_teacher (teacher_id, is_approved)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS question_answers (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                question_id INT UNSIGNED NOT NULL,
                answer TEXT NOT NULL,
                is_approved TINYINT(1) NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_answers_question (question_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS review_votes (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                review_id INT UNSIGNED NOT NULL,
                session_id VARCHAR(64) NOT NULL,
                vote TINYINT NOT NULL COMMENT '1 = upvote, -1 = downvote',
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                UNIQUE KEY uq_vote (review_id, session_id),
                KEY idx_votes_review (review_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        schemaBootstrapError = null;
        schemaBootstrapDone = true;
        console.log('✅ Schema bootstrap complete (questions, question_answers, review_votes)');
    } catch (error) {
        schemaBootstrapError = error.message;
        console.error('❌ Schema bootstrap failed:', error.message);
        // Retry a few times: the DB connection may still be warming up on cold start
        setTimeout(runSchemaBootstrap, 5000);
    }
};

// Retry wrapper: also allow manual re-trigger via /api/admin/retry-schema
let schemaRetryTimer = null;
const ensureTables = () => {
    if (schemaRetryTimer) clearTimeout(schemaRetryTimer);
    runSchemaBootstrap();
};

ensureTables();

// ========== PUBLIC API ENDPOINTS ==========

// GET /api/teachers - paginated list (20 per page)
// Supports: ?page=N&sort=name|reviews|newest&department=<name>
app.get('/api/teachers', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 20;
        const offset = (page - 1) * limit;
        const sort = req.query.sort || 'name';
        const department = req.query.department || '';

        const cacheKey = `teachers:${page}:${sort}:${department}`;
        const cached = getCached(cacheKey);
        if (cached) {
            res.set('Cache-Control', 'public, max-age=60');
            return res.json(cached);
        }

        let orderBy = 't.name';
        if (sort === 'reviews') orderBy = 'review_count DESC, t.name';
        else if (sort === 'newest') orderBy = 't.created_at DESC';

        const whereClause = department ? 'WHERE t.department = ?' : '';
        const params = [];
        if (department) params.push(department);

        const query = `
            SELECT t.*,
                   (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id = t.id AND r.is_approved = 1) as review_count
            FROM teachers t
            ${whereClause}
            ORDER BY ${orderBy}
            LIMIT ${limit} OFFSET ${offset}
        `;
        
        const [teachers] = await db.query(query, params);

        const countQuery = department ? 'SELECT COUNT(*) as total FROM teachers WHERE department = ?' : 'SELECT COUNT(*) as total FROM teachers';
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
        res.set('Cache-Control', 'public, max-age=60');
        res.json(result);
    } catch (error) {
        console.error('Error fetching teachers:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/departments - distinct departments with teacher counts
app.get('/api/departments', async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT department, COUNT(*) as teacher_count
            FROM teachers
            GROUP BY department
            ORDER BY department
        `);
        res.set('Cache-Control', 'public, max-age=3600');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching departments:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/teachers/search - search all teachers (no pagination)
// Supports: ?q=<term>&limit=N (limit used for autocomplete)
// Fuzzy matching: exact, prefix, substring, SOUNDEX (typo-tolerant), word-order tolerant
app.get('/api/teachers/search', searchLimiter, async (req, res) => {
    try {
        const searchTerm = req.query.q;
        const limit = Math.min(parseInt(req.query.limit) || 0, 50);
        if (!searchTerm || searchTerm.trim() === '') {
            return res.json([]);
        }

        const term = searchTerm.trim();
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
            term, `${term}%`, `%${term}%`, term, term, `%${term}%`,
            term, `${term}%`, `%${term}%`, term, term, `%${term}%`,
            ...(limit > 0 ? [limit] : [])
        ]);

        res.set('Cache-Control', 'public, max-age=120');
        res.json(teachers);
    } catch (error) {
        console.error('Error searching teachers:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== NEW: GET SINGLE TEACHER WITH REVIEWS ==========
app.get('/api/teachers/:id', async (req, res) => {
    try {
        const teacherId = req.params.id;

        // Get teacher
        const [teachers] = await db.query(
            'SELECT * FROM teachers WHERE id = ?',
            [teacherId]
        );
        if (teachers.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // Get approved reviews for this teacher (with vote counts)
        const [reviews] = await db.query(
            `SELECT r.*,
                    COALESCE(SUM(CASE WHEN rv.vote = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
                    COALESCE(SUM(CASE WHEN rv.vote = -1 THEN 1 ELSE 0 END), 0) AS downvotes
             FROM reviews r
             LEFT JOIN review_votes rv ON rv.review_id = r.id
             WHERE r.teacher_id = ? AND r.is_approved = 1
             GROUP BY r.id
             ORDER BY r.created_at DESC`,
            [teacherId]
        );

        // Get total review count
        const [countData] = await db.query(
            'SELECT COUNT(*) as total FROM reviews WHERE teacher_id = ? AND is_approved = 1',
            [teacherId]
        );

        res.set('Cache-Control', 'public, max-age=300');
        res.json({
            teacher: teachers[0],
            reviews: reviews,
            total_reviews: countData[0].total || 0
        });
    } catch (error) {
        console.error('Error fetching teacher details:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/teachers/:id/related - other teachers in the same department
app.get('/api/teachers/:id/related', async (req, res) => {
    try {
        const teacherId = parseInt(req.params.id);
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

// GET /api/teachers/:id/questions - Q&A for a teacher (approved only)
app.get('/api/teachers/:id/questions', async (req, res) => {
    try {
        const teacherId = parseInt(req.params.id);
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

// POST /api/questions - ask a question about a teacher
app.post('/api/questions', questionLimiter, [
    body('teacher_id').isInt({ min: 1 }).withMessage('Invalid teacher ID'),
    body('question').isLength({ min: 3, max: 500 }).withMessage('Question must be 3-500 characters')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const { teacher_id, question } = req.body;
        const sanitizedQuestion = validator.escape(question.trim());

        const [teachers] = await db.query('SELECT id FROM teachers WHERE id = ?', [teacher_id]);
        if (teachers.length === 0) return res.status(404).json({ error: 'Teacher not found' });

        const [result] = await db.query(
            `INSERT INTO questions (teacher_id, question, is_approved) VALUES (?, ?, 1)`,
            [teacher_id, sanitizedQuestion]
        );

        invalidateCache('questions');
        res.json({ success: true, question_id: result.insertId, message: 'Question submitted!' });
    } catch (error) {
        console.error('Error saving question:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/questions/:id/answers - answer an existing question
app.post('/api/questions/:id/answers', questionLimiter, [
    body('answer').isLength({ min: 1, max: 500 }).withMessage('Answer must be 1-500 characters')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const questionId = parseInt(req.params.id);
        const { answer } = req.body;
        const sanitizedAnswer = validator.escape(answer.trim());

        const [questions] = await db.query('SELECT id FROM questions WHERE id = ?', [questionId]);
        if (questions.length === 0) return res.status(404).json({ error: 'Question not found' });

        const [result] = await db.query(
            `INSERT INTO question_answers (question_id, answer, is_approved) VALUES (?, ?, 1)`,
            [questionId, sanitizedAnswer]
        );

        invalidateCache('questions');
        res.json({ success: true, answer_id: result.insertId, message: 'Answer submitted!' });
    } catch (error) {
        console.error('Error saving answer:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/reviews - submit a new review
app.post('/api/reviews', reviewLimiter, [
    body('teacher_id').isInt({ min: 1 }).withMessage('Invalid teacher ID'),
    body('comment').isLength({ min: 3, max: 1000 }).withMessage('Comment must be 3-1000 characters'),
    body('user_name').optional().isLength({ max: 100 }).withMessage('Name too long')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg });
    }
    
    try {
        const { teacher_id, rating, comment, user_name } = req.body;
        const sanitizedComment = validator.escape(comment.trim());
        const sanitizedName = user_name ? validator.escape(user_name.trim()) : 'Anonymous';
        
        const [teachers] = await db.query('SELECT id FROM teachers WHERE id = ?', [teacher_id]);
        if (teachers.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }
        
        const [result] = await db.query(
            `INSERT INTO reviews (teacher_id, rating, comment, user_name, is_approved) 
             VALUES (?, ?, ?, ?, 1)`,
            [teacher_id, Number(rating) || 5, sanitizedComment, sanitizedName]
        );
        
        invalidateCache('teachers');
        res.json({
            success: true,
            review_id: result.insertId,
            message: 'Review submitted successfully!'
        });
    } catch (error) {
        console.error('Error saving review:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/reviews/:id/vote - upvote or downvote a review
// Uses a cookie-based session_id to prevent duplicate votes (1 vote per review per session)
const voteLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30,
    message: { error: 'Too many votes. Please try again later.' }
});

app.post('/api/reviews/:id/vote', voteLimiter, [
    body('vote').isInt({ min: -1, max: 1 }).withMessage('Vote must be 1 (upvote), -1 (downvote), or 0 (remove vote)')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });

    try {
        const reviewId = parseInt(req.params.id);
        const { vote } = req.body;

        // Generate or read a session ID from a cookie (no login required)
        let sessionId = parseCookies(req)._rv_sid;
        if (!sessionId) {
            sessionId = crypto.randomBytes(16).toString('hex');
        }

        // Verify the review exists
        const [reviews] = await db.query('SELECT id FROM reviews WHERE id = ? AND is_approved = 1', [reviewId]);
        if (reviews.length === 0) return res.status(404).json({ error: 'Review not found' });

        if (vote === 0) {
            // Remove existing vote
            await db.query('DELETE FROM review_votes WHERE review_id = ? AND session_id = ?', [reviewId, sessionId]);
        } else {
            // Upsert: insert or update the vote
            await db.query(
                `INSERT INTO review_votes (review_id, session_id, vote)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE vote = VALUES(vote)`,
                [reviewId, sessionId, vote]
            );
        }

        // Return updated vote counts
        const [counts] = await db.query(
            `SELECT
                COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0) AS upvotes,
                COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0) AS downvotes
             FROM review_votes WHERE review_id = ?`,
            [reviewId]
        );

        // Get the user's current vote for this review
        const [userVote] = await db.query(
            'SELECT vote FROM review_votes WHERE review_id = ? AND session_id = ?',
            [reviewId, sessionId]
        );

        // Set session cookie if it was newly generated
        const needsCookie = !parseCookies(req)._rv_sid;
        if (needsCookie) {
            const opts = buildCookieOptions(req);
            res.cookie('_rv_sid', sessionId, { ...opts, maxAge: 365 * 24 * 60 * 60 * 1000 }); // 1 year
        }

        res.json({
            upvotes: Number(counts[0].upvotes),
            downvotes: Number(counts[0].downvotes),
            userVote: userVote.length > 0 ? userVote[0].vote : 0
        });
    } catch (error) {
        console.error('Error voting on review:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== ADMIN API ENDPOINTS ==========

app.post('/api/admin/login', loginLimiter, csrfValidate, async (req, res) => {
    // ... (your existing admin login code) ...
    try {
        const { username, password } = req.body;
        const [admins] = await db.query('SELECT * FROM admins WHERE username = ?', [username]);
        if (admins.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const admin = admins[0];
        if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
            return res.status(401).json({ error: 'Account locked. Try again later.' });
        }
        const isValid = await bcrypt.compare(password, admin.password);
        if (!isValid) {
            const failedAttempts = (admin.failed_attempts || 0) + 1;
            let lockedUntil = null;
            if (failedAttempts >= 5) lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
            await db.query('UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?', [failedAttempts, lockedUntil, admin.id]);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        await db.query('UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE id = ?', [admin.id]);
        const token = jwt.sign({ id: admin.id, username: admin.username }, JWT_SECRET, { expiresIn: '24h' });
        await createAuditLog(admin.id, 'LOGIN', 'Admin logged in', req.ip);
        res.cookie('admin_token', token, buildCookieOptions(req));
        res.json({ success: true, admin: { id: admin.id, username: admin.username } });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login error' });
    }
});

// GET /api/admin/me - validate the current admin session
app.get('/api/admin/me', verifyAdmin, (req, res) => {
    res.json({ admin: { id: req.admin.id, username: req.admin.username } });
});

// POST /api/admin/logout - clear the admin session cookie
app.post('/api/admin/logout', csrfValidate, (req, res) => {
    res.clearCookie('admin_token', { ...buildCookieOptions(req), maxAge: undefined });
    res.json({ success: true, message: 'Logged out successfully' });
});

app.post('/api/admin/forgot-password', resetLimiter, csrfValidate, async (req, res) => {
    // ... (your existing forgot password code) ...
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });
        const [admins] = await db.query('SELECT id, username FROM admins WHERE email = ?', [email]);
        if (admins.length === 0) return res.json({ success: true, message: 'If that email exists, we sent a reset link.' });
        const admin = admins[0];
        const resetToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
        await db.query('UPDATE admins SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [resetToken, tokenExpiry, admin.id]);
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;
        await sendEmail(email, 'Password Reset Request', `<p>Click <a href="${resetLink}">here</a> to reset your password. Link expires in 1 hour.</p>`);
        res.json({ success: true, message: 'Reset link sent to email.' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/reset-password', csrfValidate, async (req, res) => {
    // ... (your existing reset password code) ...
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Token and new password (min 6 chars) required' });
        const [admins] = await db.query('SELECT id FROM admins WHERE reset_token = ? AND reset_token_expires > NOW()', [token]);
        if (admins.length === 0) return res.status(400).json({ error: 'Invalid or expired token' });
        const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
        await db.query('UPDATE admins SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?', [hashedPassword, admins[0].id]);
        res.json({ success: true, message: 'Password reset successfully. You can now login.' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Server error' });
    }
});

app.post('/api/admin/setup', csrfValidate, async (req, res) => {
    // Only usable when ADMIN_SETUP_SECRET is configured and provided via x-setup-secret header
    const setupSecret = process.env.ADMIN_SETUP_SECRET;
    if (!setupSecret || req.headers['x-setup-secret'] !== setupSecret) {
        return res.status(403).json({ error: 'Setup is disabled. Configure ADMIN_SETUP_SECRET to enable it.' });
    }
    try {
        const { username, password, email } = req.body;
        if (!username || !password || !email) return res.status(400).json({ error: 'Username, password, and email required' });
        const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await db.query(
            'INSERT INTO admins (username, password, email) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE password = ?, email = ?',
            [username, hashedPassword, email, hashedPassword, email]
        );
        res.json({ success: true, message: 'Admin created. Use new credentials to login.' });
    } catch (error) {
        console.error('Setup error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin/teachers', verifyAdmin, csrfValidate, [
    body('name').isLength({ min: 2, max: 100 }).withMessage('Name must be 2-100 characters'),
    body('department').isLength({ min: 2, max: 100 }).withMessage('Department must be 2-100 characters'),
    body('image_url').optional().isURL().withMessage('Image URL must be a valid URL')
], async (req, res) => {
    // ... (your existing add teacher code) ...
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const { name, department, image_url } = req.body;
        const sanitizedName = validator.escape(name.trim());
        const sanitizedDept = validator.escape(department.trim());
        const sanitizedImageUrl = image_url ? validator.escape(image_url.trim()) : null;
        const [result] = await db.query('INSERT INTO teachers (name, department, image_url) VALUES (?, ?, ?)', [sanitizedName, sanitizedDept, sanitizedImageUrl]);
        await createAuditLog(req.admin.id, 'ADD_TEACHER', `Added teacher: ${sanitizedName}`, req.ip);
        invalidateCache('teachers');
        res.json({ success: true, id: result.insertId, message: 'Teacher added successfully' });
    } catch (error) {
        console.error('Error adding teacher:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.delete('/api/admin/teachers/:id', verifyAdmin, csrfValidate, async (req, res) => {
    // ... (your existing delete teacher code) ...
    try {
        const teacherId = req.params.id;
        const [teachers] = await db.query('SELECT name FROM teachers WHERE id = ?', [teacherId]);
        const [result] = await db.query('DELETE FROM teachers WHERE id = ?', [teacherId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Teacher not found' });
        await createAuditLog(req.admin.id, 'DELETE_TEACHER', `Deleted teacher: ${teachers[0]?.name || teacherId}`, req.ip);
        invalidateCache('teachers');
        res.json({ success: true, message: 'Teacher deleted successfully' });
    } catch (error) {
        console.error('Error deleting teacher:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== UPDATE TEACHER (admin only) ==========
app.put('/api/admin/teachers/:id', verifyAdmin, csrfValidate, [
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
        const sanitizedName = validator.escape(name.trim());
        const sanitizedDept = validator.escape(department.trim());
        const sanitizedImageUrl = image_url ? validator.escape(image_url.trim()) : null;

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

app.get('/api/admin/reviews', verifyAdmin, async (req, res) => {
    // ... (your existing get admin reviews code) ...
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const offset = (page - 1) * limit;

        const [reviews] = await db.query(`
            SELECT r.*, t.name as teacher_name 
            FROM reviews r
            JOIN teachers t ON r.teacher_id = t.id
            ORDER BY r.created_at DESC
            LIMIT ${limit} OFFSET ${offset}
        `);

        const [countResult] = await db.query('SELECT COUNT(*) as total FROM reviews');
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

app.delete('/api/admin/reviews/:id', verifyAdmin, csrfValidate, async (req, res) => {
    // ... (your existing delete review code) ...
    try {
        const reviewId = req.params.id;
        const [result] = await db.query('DELETE FROM reviews WHERE id = ?', [reviewId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Review not found' });
        await createAuditLog(req.admin.id, 'DELETE_REVIEW', `Deleted review ID: ${reviewId}`, req.ip);
        res.json({ success: true, message: 'Review deleted successfully' });
    } catch (error) {
        console.error('Error deleting review:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// GET /api/admin/questions - list questions (admin only)
app.get('/api/admin/questions', verifyAdmin, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
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
app.delete('/api/admin/questions/:id', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const questionId = req.params.id;
        await db.query('DELETE FROM question_answers WHERE question_id = ?', [questionId]);
        const [result] = await db.query('DELETE FROM questions WHERE id = ?', [questionId]);
        if (result.affectedRows === 0) return res.status(404).json({ error: 'Question not found' });
        await createAuditLog(req.admin.id, 'DELETE_QUESTION', `Deleted question ID: ${questionId}`, req.ip);
        invalidateCache('questions');
        res.json({ success: true, message: 'Question deleted successfully' });
    } catch (error) {
        console.error('Error deleting question:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
    // ... (your existing stats code) ...
    try {
        const [teacherCount] = await db.query('SELECT COUNT(*) as count FROM teachers');
        const [reviewCount] = await db.query('SELECT COUNT(*) as count FROM reviews');
        const [recentReviews] = await db.query('SELECT COUNT(*) as count FROM reviews WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)');
        res.json({
            total_teachers: teacherCount[0].count,
            total_reviews: reviewCount[0].count,
            reviews_last_week: recentReviews[0].count
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Schema status – diagnostic for the Q&A tables
app.get('/api/schema-status', async (req, res) => {
    try {
        const [questions] = await db.query("SHOW TABLES LIKE 'questions'");
        const [answers] = await db.query("SHOW TABLES LIKE 'question_answers'");
        res.json({
            questions_table: questions.length > 0,
            question_answers_table: answers.length > 0,
            bootstrap_error: schemaBootstrapError,
            bootstrap_done: schemaBootstrapDone
        });
    } catch (error) {
        res.status(500).json({ error: error.message, bootstrap_error: schemaBootstrapError });
    }
});

app.get('/api/db-test', async (req, res) => {
    try {
        const [result] = await db.query('SELECT 1 as test');
        res.json({ status: 'Connected to DB', result });
    } catch (error) {
        res.status(500).json({ status: 'DB connection failed', error: error.message });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints ready at http://localhost:${PORT}/api`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health\n`);
});