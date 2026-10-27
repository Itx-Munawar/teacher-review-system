// Schema bootstrap: idempotent migrations that run on every start.

const db = require('../db');
const state = require('../state');
const { pruneAuditLogs } = require('../lib/audit');
const { pruneSearchGaps } = require('../lib/searchGaps');
const { pruneChatData } = require('../lib/chatUsage');
const { runReviewFilterSweep, runQaFilterSweep, runSensitiveReviewBackfill, runTeacherTidySweep } = require('./sweeps');

// ========== SCHEMA BOOTSTRAP ==========
// Creates tables that may be added after the initial deployment, so the
// server can auto-migrate on Render without manual SQL.
let schemaBootstrapError = null;
let schemaBootstrapDone = false;

// MySQL has no "ADD INDEX IF NOT EXISTS", so check the catalogue first.
const ensureIndex = async (table, indexName, definition) => {
    try {
        const [rows] = await db.query(
            `SELECT 1 FROM information_schema.statistics
              WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?
              LIMIT 1`,
            [table, indexName]
        );
        if (rows.length === 0) {
            await db.query(`ALTER TABLE \`${table}\` ADD INDEX \`${indexName}\` ${definition}`);
            console.log(`✅ Added index ${indexName} on ${table}`);
        }
    } catch (error) {
        console.error(`⚠️ Could not ensure index ${indexName} on ${table}:`, error.message);
    }
};

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
            state.reviewModerationColumnReady = true;
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

        // Replies under published reviews (moderated like Q&A answers). No FK
        // on review_id, matching the questions table, so the bootstrap works
        // with either INT type. The retired review_reports table is left alone.
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS review_replies (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    review_id INT UNSIGNED NOT NULL,
                    reply TEXT NOT NULL,
                    user_name VARCHAR(100) NOT NULL DEFAULT 'Anonymous',
                    is_approved TINYINT(1) NOT NULL DEFAULT 0,
                    moderation_flag VARCHAR(20) DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    KEY idx_review_replies_review (review_id, is_approved),
                    KEY idx_review_replies_pending (is_approved, created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            state.reviewRepliesReady = true;
        } catch (repliesErr) {
            console.error('⚠️ Could not ensure review_replies table:', repliesErr.message);
        }

        // Helpful votes: counter column on reviews plus one row per vote.
        try {
            const [helpfulCol] = await db.query("SHOW COLUMNS FROM reviews LIKE 'helpful_count'");
            if (helpfulCol.length === 0) {
                await db.query('ALTER TABLE reviews ADD COLUMN helpful_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER moderation_flag');
                console.log('✅ Added helpful_count column to reviews table');
            }
        } catch (helpfulErr) {
            console.error('⚠️ Could not ensure reviews.helpful_count:', helpfulErr.message);
        }

        // Tables for votes, AI summaries, error tracking and analytics. Each
        // feature checks its own flag, so one failure only disables that one.
        const featureTables = [
            ['review_votes', 'reviewVotesReady', `
                CREATE TABLE IF NOT EXISTS review_votes (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    review_id INT UNSIGNED NOT NULL,
                    voter_hash CHAR(64) NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_review_vote_once (review_id, voter_hash),
                    KEY idx_review_votes_created (created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `],
            ['teacher_summaries', 'teacherSummariesReady', `
                CREATE TABLE IF NOT EXISTS teacher_summaries (
                    teacher_id INT UNSIGNED NOT NULL,
                    summary TEXT NOT NULL,
                    signature CHAR(40) NOT NULL,
                    review_count INT UNSIGNED NOT NULL DEFAULT 0,
                    model VARCHAR(64) DEFAULT NULL,
                    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (teacher_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `],
            ['error_logs', 'errorLogsReady', `
                CREATE TABLE IF NOT EXISTS error_logs (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    fingerprint CHAR(40) NOT NULL,
                    source VARCHAR(16) NOT NULL,
                    message VARCHAR(500) NOT NULL,
                    stack TEXT,
                    path VARCHAR(300) DEFAULT NULL,
                    method VARCHAR(10) DEFAULT NULL,
                    user_agent VARCHAR(300) DEFAULT NULL,
                    occurrences INT UNSIGNED NOT NULL DEFAULT 1,
                    first_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    last_seen TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    alerted_at DATETIME DEFAULT NULL,
                    resolved TINYINT(1) NOT NULL DEFAULT 0,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_error_fingerprint (fingerprint),
                    KEY idx_error_logs_open (resolved, last_seen)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `],
            ['site_visits_daily', 'analyticsReady', `
                CREATE TABLE IF NOT EXISTS site_visits_daily (
                    day DATE NOT NULL,
                    visits INT UNSIGNED NOT NULL DEFAULT 0,
                    PRIMARY KEY (day)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `],
            ['teacher_views_daily', 'analyticsReady', `
                CREATE TABLE IF NOT EXISTS teacher_views_daily (
                    day DATE NOT NULL,
                    teacher_id INT UNSIGNED NOT NULL,
                    views INT UNSIGNED NOT NULL DEFAULT 0,
                    PRIMARY KEY (day, teacher_id),
                    KEY idx_teacher_views_teacher (teacher_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `],
            ['search_terms_daily', 'analyticsReady', `
                CREATE TABLE IF NOT EXISTS search_terms_daily (
                    day DATE NOT NULL,
                    term VARCHAR(100) NOT NULL,
                    searches INT UNSIGNED NOT NULL DEFAULT 0,
                    results INT UNSIGNED NOT NULL DEFAULT 0,
                    PRIMARY KEY (day, term)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `],
        ];
        const failedFlags = new Set();
        for (const [table, flag, ddl] of featureTables) {
            try {
                await db.query(ddl);
            } catch (tableErr) {
                failedFlags.add(flag);
                console.error(`⚠️ Could not ensure ${table} table:`, tableErr.message);
            }
        }
        for (const flag of new Set(featureTables.map(([, f]) => f))) {
            if (!failedFlags.has(flag)) state[flag] = true;
        }
        if (failedFlags.has('reviewVotesReady') === false) {
            try {
                const [col] = await db.query("SHOW COLUMNS FROM reviews LIKE 'helpful_count'");
                if (col.length === 0) state.reviewVotesReady = false;
            } catch (_) { state.reviewVotesReady = false; }
        }

        // Session revocation switch (see verifyAdmin). Existing admins start at
        // 0, which matches tokens issued before this column existed, so nobody
        // is logged out by the migration itself.
        try {
            const [tvCol] = await db.query("SHOW COLUMNS FROM admins LIKE 'token_version'");
            if (tvCol.length === 0) {
                await db.query('ALTER TABLE admins ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0');
                console.log('✅ Added token_version column to admins table');
            }
            state.adminTokenVersionReady = true;
        } catch (tvErr) {
            console.error('⚠️ Could not ensure admins.token_version column:', tvErr.message);
        }
        // Optional TOTP two-factor column. Defaults allow the auth path to work
        // for all existing admins without touching their rows.
        try {
            const [totpCols] = await db.query("SHOW COLUMNS FROM admins LIKE 'totp_enabled'");
            if (totpCols.length === 0) {
                await db.query('ALTER TABLE admins ADD COLUMN totp_secret VARCHAR(64) DEFAULT NULL');
                await db.query('ALTER TABLE admins ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0');
                console.log('✅ Added TOTP columns to admins table');
            }
        } catch (totpErr) {
            console.error('⚠️ Could not ensure admins.totp_* columns:', totpErr.message);
        }
        // Zero-result search terms (content-gap signals). Pruned after 30 days.
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS search_gaps (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    query VARCHAR(200) NOT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    KEY idx_search_gaps_created (created_at),
                    KEY idx_search_gaps_query (query)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            state.searchGapsReady = true;
        } catch (gapsErr) {
            console.error('⚠️ Could not ensure search_gaps table:', gapsErr.message);
        }

        // Review assistant: daily usage counters (never the text of a question)
        // and the answers students rated. Both pruned after 90 days.
        try {
            await db.query(`
                CREATE TABLE IF NOT EXISTS chat_usage_daily (
                    day DATE NOT NULL,
                    metric VARCHAR(24) NOT NULL,
                    mkey VARCHAR(120) NOT NULL,
                    count INT UNSIGNED NOT NULL DEFAULT 0,
                    PRIMARY KEY (day, metric, mkey)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await db.query(`
                CREATE TABLE IF NOT EXISTS chat_feedback (
                    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
                    token_hash CHAR(64) NOT NULL,
                    rating TINYINT NOT NULL,
                    question VARCHAR(600) NOT NULL,
                    answer TEXT NOT NULL,
                    teacher_ids VARCHAR(100) NOT NULL DEFAULT '',
                    comment VARCHAR(500) DEFAULT NULL,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    PRIMARY KEY (id),
                    UNIQUE KEY uq_chat_feedback_token (token_hash),
                    KEY idx_chat_feedback_created (created_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            state.chatUsageReady = true;
        } catch (chatErr) {
            console.error('⚠️ Could not ensure chat usage tables:', chatErr.message);
        }

        // Composite indexes for the two hottest list queries: department pages
        // (WHERE department = ? ORDER BY name) and the public Q&A board
        // (WHERE is_approved = 1 ORDER BY created_at DESC).
        await ensureIndex('teachers', 'idx_teachers_department_name', '(department, name)');
        await ensureIndex('questions', 'idx_questions_approved_created', '(is_approved, created_at)');

        schemaBootstrapError = null;
        schemaBootstrapDone = true;
        console.log('✅ Schema bootstrap complete (questions, question_answers, custom_courses, review_replies, votes, summaries, errors, analytics, cleanup)');
        // Keep the audit trail bounded (and the hashed IPs with it).
        pruneAuditLogs();
        pruneSearchGaps();
        pruneChatData();
        require('../lib/errorTracker').pruneErrorLogs();
        require('../lib/analytics').pruneAnalytics();
        // Schema is up: retroactively filter any pre-existing reviews.
        runReviewFilterSweep();
        runQaFilterSweep();
        runSensitiveReviewBackfill();
        runTeacherTidySweep();
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

module.exports = {
    ensureIndex,
    runSchemaBootstrap,
    ensureTables
};
