require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const { body, validationResult } = require('express-validator');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const db = require('./db');
const { csrfSetCookie, csrfValidate } = require('./csrf');
const { detectFlaggedText, moderationFlagFor, sweepExistingReviews, sweepExistingQa } = require('./contentFilter');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET;
const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 10;

// ========== ENV VALIDATION ==========
const missingVars = [];
if (!JWT_SECRET) missingVars.push('JWT_SECRET');
if (!process.env.FRONTEND_URL) missingVars.push('FRONTEND_URL');
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD || !process.env.DB_NAME) missingVars.push('DB_*');
if (!process.env.EMAIL_USER || !process.env.EMAIL_PASS) missingVars.push('EMAIL_USER/EMAIL_PASS');
if (missingVars.length > 0) {
    console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Server will not start. Fix the environment configuration and retry.');
    process.exit(1);
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

// Reporting is cheap for a user and expensive for a moderator, so keep the
// per-IP budget tight. Duplicate reports for the same review are collapsed.
const reportLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { error: 'Too many reports. Please try again later.' }
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

// Mirrors isUsableImageUrl() in frontend/src/utils/imageThumb.ts, so the DB is
// cleaned using exactly the rule the UI uses to choose between a photo and an
// initials avatar. A bare directory URL such as
// "https://admin.umt.edu.pk/Media/UserProfile/" is not a usable image.
const isUsableTeacherImageUrl = (url) => {
    const trimmed = (url || '').trim();
    if (!/^https?:\/\//i.test(trimmed)) return false;
    try {
        const { hostname, pathname } = new URL(trimmed);
        if (!hostname) return false;
        const filename = pathname.split('/').filter(Boolean).pop() || '';
        return /\.(jpe?g|png|webp|gif|avif)$/i.test(filename);
    } catch (error) {
        return false;
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

// Normalises user text for duplicate comparison: lowercase, punctuation and
// whitespace collapsed, so "Best teacher!!" and "best   teacher" are equal.
const normalizeReviewText = (text) =>
    String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Marks set by the schema bootstrap below. Both default to false so a request
// that arrives while the DB is still migrating degrades instead of erroring.
let reviewModerationColumnReady = false;
let reviewReportsReady = false;

// Departments are free text on each teacher row, so normalise what an admin
// types: collapse whitespace, and reuse the spelling/case of an existing
// department (case-insensitive match) so "computer science" and
// "Computer Science" never become two separate filters.
const normalizeDepartment = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
const canonicalDepartment = async (value) => {
    const cleaned = normalizeDepartment(value);
    if (!cleaned) return cleaned;
    const [rows] = await db.query('SELECT department FROM teachers WHERE LOWER(department) = LOWER(?) LIMIT 1', [cleaned]);
    return rows.length > 0 ? rows[0].department : cleaned;
};

// ========== ONE-TIME RETROACTIVE REVIEW FILTER SWEEP ==========
// Runs the NLP content filter over reviews that existed before the filter
// was added: flagged approved reviews are queued for admin moderation.
// Gated by an audit_logs marker so it runs once (not on every boot); the
// admin endpoint POST /api/admin/filter-reviews re-runs it explicitly.
let reviewSweepAttempts = 0;
let reviewSweepDone = false;

const runReviewFilterSweep = async () => {
    if (reviewSweepDone) return;
    try {
        const [marker] = await db.query("SELECT id FROM audit_logs WHERE action = 'SWEEP_REVIEWS' LIMIT 1");
        if (marker.length > 0) {
            reviewSweepDone = true;
            return;
        }
        const result = await sweepExistingReviews(db);
        if (result.toQueue > 0) invalidateCache('teachers');
        reviewSweepDone = true;
        await db.query(
            "INSERT INTO audit_logs (action, details, ip_address) VALUES ('SWEEP_REVIEWS', ?, 'system')",
            [JSON.stringify({ scanned: result.scanned, queued: result.toQueue, alreadyQueued: result.alreadyQueued })]
        );
        console.log(`🔎 Review filter sweep: scanned ${result.scanned}, queued ${result.toQueue} for admin review (${result.alreadyQueued} already queued)`);
    } catch (error) {
        reviewSweepAttempts += 1;
        console.error('❌ Review filter sweep failed:', error.message);
        // The DB may still be warming up (or schema.sql not applied yet).
        if (reviewSweepAttempts < 10) setTimeout(runReviewFilterSweep, 30000);
    }
};

// One-time retroactive sweep for questions, answers and custom courses
// (marker action SWEEP_QA keeps it independent from the reviews sweep).
let qaSweepAttempts = 0;
let qaSweepDone = false;

const runQaFilterSweep = async () => {
    if (qaSweepDone) return;
    try {
        const [marker] = await db.query("SELECT id FROM audit_logs WHERE action = 'SWEEP_QA' LIMIT 1");
        if (marker.length > 0) {
            qaSweepDone = true;
            return;
        }
        const result = await sweepExistingQa(db);
        if (result.questions.toQueue > 0 || result.answers.toQueue > 0) invalidateCache('questions');
        if (result.courses.toDemote > 0) invalidateCache('courses');
        qaSweepDone = true;
        await db.query(
            "INSERT INTO audit_logs (action, details, ip_address) VALUES ('SWEEP_QA', ?, 'system')",
            [JSON.stringify({
                questions: result.questions.toQueue,
                answers: result.answers.toQueue,
                courses: result.courses.toDemote
            })]
        );
        console.log(`🔎 Q&A filter sweep: ${result.questions.toQueue} question(s), ${result.answers.toQueue} answer(s), ${result.courses.toDemote} course(s) queued`);
    } catch (error) {
        qaSweepAttempts += 1;
        console.error('❌ Q&A filter sweep failed:', error.message);
        if (qaSweepAttempts < 10) setTimeout(runQaFilterSweep, 30000);
    }
};

// One-time backfill: mark existing reviews that contain conduct allegations so
// they surface first in the admin queue. It only sets a triage marker and
// never changes approval state, so it cannot publish or hide anything.
let sensitiveBackfillAttempts = 0;
let sensitiveBackfillDone = false;

const runSensitiveReviewBackfill = async () => {
    if (sensitiveBackfillDone || !reviewModerationColumnReady) return;
    try {
        const [marker] = await db.query("SELECT id FROM audit_logs WHERE action = 'FLAG_SENSITIVE_REVIEWS' LIMIT 1");
        if (marker.length > 0) {
            sensitiveBackfillDone = true;
            return;
        }

        const [rows] = await db.query(
            'SELECT id, comment, user_name, courses FROM reviews WHERE moderation_flag IS NULL'
        );
        const flaggedIds = rows
            .filter((row) => moderationFlagFor(`${row.comment || ''} ${row.user_name || ''} ${row.courses || ''}`) === 'sensitive')
            .map((row) => row.id);

        const CHUNK = 500;
        for (let i = 0; i < flaggedIds.length; i += CHUNK) {
            const chunk = flaggedIds.slice(i, i + CHUNK);
            await db.query(
                `UPDATE reviews SET moderation_flag = 'sensitive' WHERE id IN (${chunk.map(() => '?').join(',')})`,
                chunk
            );
        }

        sensitiveBackfillDone = true;
        await db.query(
            "INSERT INTO audit_logs (action, details, ip_address) VALUES ('FLAG_SENSITIVE_REVIEWS', ?, 'system')",
            [JSON.stringify({ scanned: rows.length, flagged: flaggedIds.length })]
        );
        console.log(`🔎 Sensitive-review backfill: scanned ${rows.length}, flagged ${flaggedIds.length}`);
    } catch (error) {
        sensitiveBackfillAttempts += 1;
        console.error('❌ Sensitive-review backfill failed:', error.message);
        if (sensitiveBackfillAttempts < 10) setTimeout(runSensitiveReviewBackfill, 30000);
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
                is_approved TINYINT(1) NOT NULL DEFAULT 0,
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
                is_approved TINYINT(1) NOT NULL DEFAULT 0,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (id),
                KEY idx_answers_question (question_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        // Custom courses: user-added course names awaiting admin approval
        await db.query(`
            CREATE TABLE IF NOT EXISTS custom_courses (
                id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                name VARCHAR(200) NOT NULL,
                name_key VARCHAR(200) NOT NULL,
                status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
                times_used INT UNSIGNED NOT NULL DEFAULT 1,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                reviewed_at TIMESTAMP NULL DEFAULT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_custom_course_key (name_key),
                KEY idx_custom_courses_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        // Drop the old review_votes table (vote feature removed)
        await db.query('DROP TABLE IF EXISTS review_votes');

        // Add courses column to reviews if it doesn't exist (standalone try-catch)
        try {
            const [coursesCol] = await db.query("SHOW COLUMNS FROM reviews LIKE 'courses'");
            const [courseCol] = await db.query("SHOW COLUMNS FROM reviews LIKE 'course'");
            if (coursesCol.length === 0 && courseCol.length === 0) {
                await db.query('ALTER TABLE reviews ADD COLUMN courses VARCHAR(2000) NULL AFTER user_name');
                console.log('✅ Added courses column to reviews table');
            } else if (courseCol.length > 0 && coursesCol.length === 0) {
                await db.query('ALTER TABLE reviews CHANGE course courses VARCHAR(2000) NULL');
                console.log('✅ Renamed course column to courses');
            } else {
                console.log('✅ Courses column already exists');
            }
        } catch (colErr) {
            console.error('⚠️ Could not ensure courses column:', colErr.message);
        }

        // Triage marker for reviews that need a human decision before they go
        // public (harassment/threat allegations). NULL means "no signal".
        try {
            const [flagCol] = await db.query("SHOW COLUMNS FROM reviews LIKE 'moderation_flag'");
            if (flagCol.length === 0) {
                await db.query('ALTER TABLE reviews ADD COLUMN moderation_flag VARCHAR(40) NULL AFTER is_approved');
                console.log('✅ Added moderation_flag column to reviews table');
            }
            reviewModerationColumnReady = true;
        } catch (flagErr) {
            console.error('⚠️ Could not ensure moderation_flag column:', flagErr.message);
        }

        // rating is a legacy column: the UI no longer collects it. The old
        // NOT NULL DEFAULT 5 silently recorded every new review as five stars,
        // which poisoned anything that averages ratings. Make it nullable so
        // new rows are honestly empty, and leave existing values untouched.
        try {
            const [ratingCol] = await db.query("SHOW COLUMNS FROM reviews LIKE 'rating'");
            if (ratingCol.length > 0 && ratingCol[0].Null === 'NO') {
                await db.query('ALTER TABLE reviews MODIFY COLUMN rating TINYINT UNSIGNED NULL DEFAULT NULL');
                console.log('✅ reviews.rating is now nullable (legacy column, no longer written)');
            }
        } catch (ratingErr) {
            console.error('⚠️ Could not relax reviews.rating:', ratingErr.message);
        }

        // Reader reports on published reviews. No FK on review_id, matching the
        // questions table, so the bootstrap works with either INT type.
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS review_reports (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    review_id INT UNSIGNED NOT NULL,
                    reason VARCHAR(300) NOT NULL,
                    reporter_hash CHAR(64) NOT NULL,
                    status ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_review_report_once (review_id, reporter_hash),
                    KEY idx_review_reports_status (status)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            reviewReportsReady = true;
        } catch (reportsErr) {
            console.error('⚠️ Could not ensure review_reports table:', reportsErr.message);
        }
        schemaBootstrapError = null;
        schemaBootstrapDone = true;
        console.log('✅ Schema bootstrap complete (questions, question_answers, custom_courses, review_reports, cleanup)');
        // Schema is up: retroactively filter any pre-existing reviews.
        runReviewFilterSweep();
        runQaFilterSweep();
        runSensitiveReviewBackfill();
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

// GET /api/teachers - paginated list (20 per page by default)
// Supports: ?page=N&limit=20..200&sort=name|reviews|newest&department=<name>
app.get('/api/teachers', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        // limit: the admin panel pulls the whole teacher list in big pages so
        // its sorting covers every row; public callers keep the default of 20.
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 200);
        const offset = (page - 1) * limit;
        const sort = req.query.sort || 'name';
        const department = req.query.department || '';

        const cacheKey = `teachers:${page}:${limit}:${sort}:${department}`;
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

        // Ensure courses column exists (cold-start safety net)
        try {
            const [coursesCol] = await db.query("SHOW COLUMNS FROM reviews LIKE 'courses'");
            if (coursesCol.length === 0) {
                await db.query('ALTER TABLE reviews ADD COLUMN courses VARCHAR(2000) NULL AFTER user_name');
                console.log('✅ Added courses column to reviews table (via teacher detail)');
            }
        } catch (e) { /* non-critical */ }

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
             ORDER BY r.created_at DESC`,
            [teacherId]
        );

        // Get total review count
        const [countData] = await db.query(
            'SELECT COUNT(*) as total FROM reviews WHERE teacher_id = ? AND is_approved = 1',
            [teacherId]
        );


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
        const sanitizedQuestion = question.trim().slice(0, 1000);

        const [teachers] = await db.query('SELECT id FROM teachers WHERE id = ?', [teacher_id]);
        if (teachers.length === 0) return res.status(404).json({ error: 'Teacher not found' });

        // Moderation-first: every question starts pending (is_approved=0)
        // and only becomes public once an admin approves it in the panel.
        const [result] = await db.query(
            `INSERT INTO questions (teacher_id, question, is_approved) VALUES (?, ?, ?)`,
            [teacher_id, sanitizedQuestion, 0]
        );

        invalidateCache('questions');
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
app.post('/api/questions/:id/answers', questionLimiter, [
    body('answer').isLength({ min: 1, max: 500 }).withMessage('Answer must be 1-500 characters')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    try {
        const questionId = parseInt(req.params.id);
        const { answer } = req.body;
        const sanitizedAnswer = answer.trim().slice(0, 1000);

        const [questions] = await db.query('SELECT id FROM questions WHERE id = ?', [questionId]);
        if (questions.length === 0) return res.status(404).json({ error: 'Question not found' });

        // Moderation-first: every answer starts pending (is_approved=0)
        // and only becomes public once an admin approves it in the panel.
        const [result] = await db.query(
            `INSERT INTO question_answers (question_id, answer, is_approved) VALUES (?, ?, ?)`,
            [questionId, sanitizedAnswer, 0]
        );

        invalidateCache('questions');
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
app.post('/api/reviews', reviewLimiter, [
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
        if (reviewModerationColumnReady) {
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
app.post('/api/reviews/:id/report', reportLimiter, [
    body('reason')
        .customSanitizer((value) => String(value || '').trim())
        .isLength({ min: 3, max: 300 })
        .withMessage('Please give a short reason (3-300 characters)')
], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ error: errors.array()[0].msg, code: 'VALIDATION_ERROR' });
    }

    if (!reviewReportsReady) {
        return res.status(503).json({ error: 'Reporting is temporarily unavailable. Please try again shortly.' });
    }

    try {
        const reviewId = parseInt(req.params.id, 10);
        if (!Number.isInteger(reviewId) || reviewId < 1) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const [reviews] = await db.query('SELECT id FROM reviews WHERE id = ?', [reviewId]);
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

// ========== ADMIN API ENDPOINTS ==========

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
        // Store only a SHA-256 hash; the raw token exists only in the emailed link
        const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
        await db.query('UPDATE admins SET reset_token = ?, reset_token_expires = ? WHERE id = ?', [resetTokenHash, tokenExpiry, admin.id]);
        const frontendUrl = process.env.FRONTEND_URL;
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
        if (!token || typeof token !== 'string' || !newPassword || typeof newPassword !== 'string' || newPassword.length < 10) {
            return res.status(400).json({ error: 'Token and new password (min 10 chars) required' });
        }
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const [admins] = await db.query('SELECT id FROM admins WHERE reset_token = ? AND reset_token_expires > NOW()', [tokenHash]);
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
    // Require ADMIN_SETUP_KEY env var + x-setup-secret header (constant-time comparison)
    const setupKey = process.env.ADMIN_SETUP_KEY;
    const providedHeader = req.headers['x-setup-secret'];
    if (!setupKey) {
        // Return 404 so the endpoint doesn't even register as existing when the key is unset
        return res.status(404).json({ error: 'Not found' });
    }
    if (!providedHeader || typeof providedHeader !== 'string') {
        return res.status(401).json({ error: 'Setup token required' });
    }
    const keyBuffer = Buffer.from(setupKey, 'utf8');
    const headerBuffer = Buffer.from(providedHeader, 'utf8');
    if (keyBuffer.length !== headerBuffer.length || !crypto.timingSafeEqual(keyBuffer, headerBuffer)) {
        return res.status(401).json({ error: 'Invalid setup token' });
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
        res.status(500).json({ error: 'Server error' });
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
        const sanitizedName = name.trim().slice(0, 200);
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

// ========== GET TEACHER DETAILS (admin only) — full info + ALL reviews ==========
app.get('/api/admin/teachers/:id', verifyAdmin, async (req, res) => {
    try {
        const teacherId = req.params.id;

        const [teachers] = await db.query('SELECT * FROM teachers WHERE id = ?', [teacherId]);
        if (teachers.length === 0) {
            return res.status(404).json({ error: 'Teacher not found' });
        }

        // ALL reviews (approved + pending) — admins see everything
        const [reviews] = await db.query(
            `SELECT r.*, t.name as teacher_name
             FROM reviews r
             JOIN teachers t ON r.teacher_id = t.id
             WHERE r.teacher_id = ?
             ORDER BY r.created_at DESC`,
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
        const sanitizedName = name.trim().slice(0, 200);
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
app.post('/api/admin/clean-teacher-images', verifyAdmin, csrfValidate, async (req, res) => {
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

app.get('/api/admin/reviews', verifyAdmin, async (req, res) => {
    // ... (your existing get admin reviews code) ...
    try {
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 50, 1), 100);
        const offset = (page - 1) * limit;

        // Optional moderation filter: ?pending=1 returns only unapproved
        // rows (used by the dashboard "pending" counter click-through).
        const pendingOnly = req.query.pending === '1' || req.query.pending === 'true';
        const whereClause = pendingOnly ? 'WHERE r.is_approved = 0' : '';
        const reportSelect = reviewReportsReady
            ? `, (SELECT COUNT(*) FROM review_reports rr WHERE rr.review_id = r.id AND rr.status = 'open') AS open_reports`
            : '';

        const [reviews] = await db.query(`
            SELECT r.*, t.name as teacher_name${reportSelect}
            FROM reviews r
            JOIN teachers t ON r.teacher_id = t.id
            ${whereClause}
            ORDER BY r.created_at DESC
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

// PUT /api/admin/reviews/:id - edit a review (admin only)
// Accepts optional is_approved field to toggle approval status.
// When is_approved is omitted, only comment/user_name are updated (existing behavior).
app.put('/api/admin/reviews/:id', verifyAdmin, csrfValidate, [
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
app.post('/api/admin/filter-reviews', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const dryRun = String(req.query.dryRun) === 'true' || (req.body && req.body.dryRun === true);
        const result = await sweepExistingReviews(db, { dryRun });
        if (!dryRun) {
            if (result.toQueue > 0) invalidateCache('teachers');
            // An explicit run also satisfies the one-time boot sweep.
            reviewSweepDone = true;
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
app.post('/api/admin/filter-qa', verifyAdmin, csrfValidate, async (req, res) => {
    try {
        const dryRun = String(req.query.dryRun) === 'true' || (req.body && req.body.dryRun === true);
        const result = await sweepExistingQa(db, { dryRun });
        if (!dryRun) {
            if (result.questions.toQueue > 0 || result.answers.toQueue > 0) invalidateCache('questions');
            if (result.courses.toDemote > 0) invalidateCache('courses');
            qaSweepDone = true;
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

// PUT /api/admin/questions/:id - approve/reject (or edit) a question (admin only)
app.put('/api/admin/questions/:id', verifyAdmin, csrfValidate, [
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
        invalidateCache('questions');
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
app.put('/api/admin/answers/:id', verifyAdmin, csrfValidate, [
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
        invalidateCache('questions');
        res.json({
            success: true,
            message: is_approved === undefined ? 'Answer updated' : (is_approved ? 'Answer approved' : 'Answer rejected')
        });
    } catch (error) {
        console.error('Error updating answer:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// POST /api/admin/reviews/bulk - approve or reject many reviews at once
app.post('/api/admin/reviews/bulk', verifyAdmin, csrfValidate, [
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

// ========== CUSTOM COURSES (community-added, admin-approved) ==========
// POST /api/custom-courses – student suggests a custom course for admin approval
app.post('/api/custom-courses', questionLimiter, [
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
app.get('/api/custom-courses', async (req, res) => {
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
app.get('/api/admin/custom-courses', verifyAdmin, async (req, res) => {
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
app.put('/api/admin/custom-courses/:id', verifyAdmin, csrfValidate, async (req, res) => {
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
        invalidateCache('courses');
        res.json({ success: true, message: `Course ${action}d successfully` });
    } catch (error) {
        console.error('Error updating custom course:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
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

        res.json({
            total_teachers: teacherCount[0].count,
            total_reviews: reviewCount[0].count,
            reviews_last_week: recentReviews[0].count,
            pending_reviews: pendingCount[0].count,
            last_sweep
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: 'Database error' });
    }
});

// ========== DYNAMIC SITEMAP.XML ==========
app.get('/sitemap.xml', async (req, res) => {
    try {
        const [teachers] = await db.query('SELECT id, name, department FROM teachers ORDER BY name');
        const [departments] = await db.query('SELECT DISTINCT department FROM teachers ORDER BY department');
        const today = new Date().toISOString().split('T')[0];
        const baseUrl = 'https://teacher-review-system-zeta.vercel.app';

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        // Homepage
        xml += `  <url>\n    <loc>${baseUrl}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;

        // Static pages
        const staticPages = ['privacy', 'terms', 'dmca', 'about', 'contact'];
        staticPages.forEach(page => {
            xml += `  <url>\n    <loc>${baseUrl}/${page}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>yearly</changefreq>\n    <priority>0.3</priority>\n  </url>\n`;
        });

        // Department pages
        departments.forEach(dept => {
            const encoded = encodeURIComponent(dept.department);
            xml += `  <url>\n    <loc>${baseUrl}/department/${encoded}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
        });

        // Teacher pages
        teachers.forEach(teacher => {
            xml += `  <url>\n    <loc>${baseUrl}/teacher/${teacher.id}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
        });

        xml += '</urlset>';

        res.set('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        console.error('Error generating sitemap:', error);
        res.status(500).send('Error generating sitemap');
    }
});

// ========== DYNAMIC ROBOTS.TXT ==========
app.get('/robots.txt', (req, res) => {
    const baseUrl = 'https://teacher-review-system-zeta.vercel.app';
    const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml
`;
    res.set('Content-Type', 'text/plain');
    res.send(robots);
});

// Health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
    console.log(`\n🚀 Server running on http://localhost:${PORT}`);
    console.log(`📊 API endpoints ready at http://localhost:${PORT}/api`);
    console.log(`✅ Health check: http://localhost:${PORT}/api/health\n`);
});