-- =============================================================
-- Teacher Review System - MySQL Schema
-- Used by the Express backend (see db.js). Run against the
-- configured database before starting the server.
-- =============================================================

-- Teachers / faculty members
CREATE TABLE IF NOT EXISTS teachers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL,
    image_url VARCHAR(500) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_teachers_name (name),
    KEY idx_teachers_department (department),
    KEY idx_teachers_department_name (department, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reviews written by students (rating kept for legacy data; no longer used by the UI)
CREATE TABLE IF NOT EXISTS reviews (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    teacher_id INT UNSIGNED NOT NULL,
    rating TINYINT UNSIGNED NULL DEFAULT NULL,
    comment TEXT NOT NULL,
    courses VARCHAR(2000) DEFAULT NULL,
    user_name VARCHAR(100) NOT NULL DEFAULT 'Anonymous',
    is_approved TINYINT(1) NOT NULL DEFAULT 0,
    moderation_flag VARCHAR(40) DEFAULT NULL,
    helpful_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_reviews_teacher (teacher_id, is_approved),
    KEY idx_reviews_created (created_at),
    CONSTRAINT fk_reviews_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Replies under published reviews. Every reply starts pending (is_approved=0)
-- and is shown only after an admin approves it.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One helpful vote per review per browser. voter_hash is a keyed hash of a
-- random cookie id; no IP address is stored.
CREATE TABLE IF NOT EXISTS review_votes (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    review_id INT UNSIGNED NOT NULL,
    voter_hash CHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_review_vote_once (review_id, voter_hash),
    KEY idx_review_votes_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cached AI summary of a teacher's approved reviews. signature changes when
-- the set of approved reviews changes, which triggers a regeneration.
CREATE TABLE IF NOT EXISTS teacher_summaries (
    teacher_id INT UNSIGNED NOT NULL,
    summary TEXT NOT NULL,
    signature CHAR(40) NOT NULL,
    review_count INT UNSIGNED NOT NULL DEFAULT 0,
    model VARCHAR(64) DEFAULT NULL,
    generated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Backend and browser errors, grouped by fingerprint.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Anonymous daily counters for the admin Analytics tab (no per-user data).
CREATE TABLE IF NOT EXISTS site_visits_daily (
    day DATE NOT NULL,
    visits INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS teacher_views_daily (
    day DATE NOT NULL,
    teacher_id INT UNSIGNED NOT NULL,
    views INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (day, teacher_id),
    KEY idx_teacher_views_teacher (teacher_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS search_terms_daily (
    day DATE NOT NULL,
    term VARCHAR(100) NOT NULL,
    searches INT UNSIGNED NOT NULL DEFAULT 0,
    results INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (day, term)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin users (password column stores a bcrypt hash)
CREATE TABLE IF NOT EXISTS admins (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    username VARCHAR(100) NOT NULL,
    password VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    failed_attempts INT UNSIGNED NOT NULL DEFAULT 0,
    locked_until DATETIME DEFAULT NULL,
    reset_token VARCHAR(64) DEFAULT NULL,
    reset_token_expires DATETIME DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_admins_username (username),
    KEY idx_admins_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit trail of admin actions
CREATE TABLE IF NOT EXISTS audit_logs (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    admin_id INT UNSIGNED DEFAULT NULL,
    action VARCHAR(50) NOT NULL,
    details VARCHAR(500) DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_audit_admin (admin_id),
    KEY idx_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
-- Questions asked about a teacher (anonymous Q&A)
-- NOTE: no FOREIGN KEY on teacher_id so the bootstrap works with any
-- production teachers.id type (INT vs INT UNSIGNED); the app validates
-- teacher existence before insert.
CREATE TABLE IF NOT EXISTS questions (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    teacher_id INT NOT NULL,
    question TEXT NOT NULL,
    is_approved TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_questions_teacher (teacher_id, is_approved),
    KEY idx_questions_approved_created (is_approved, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Answers submitted to a question (one question can have many answers)
CREATE TABLE IF NOT EXISTS question_answers (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    question_id INT UNSIGNED NOT NULL,
    answer TEXT NOT NULL,
    is_approved TINYINT(1) NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_answers_question (question_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Review assistant: daily usage counters (no message text) and answer ratings.
CREATE TABLE IF NOT EXISTS chat_usage_daily (
    day DATE NOT NULL,
    metric VARCHAR(24) NOT NULL,
    mkey VARCHAR(120) NOT NULL,
    count INT UNSIGNED NOT NULL DEFAULT 0,
    PRIMARY KEY (day, metric, mkey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Saved chat answers (first question of a conversation), keyed by the
-- question, page teacher and data version, so repeat questions cost no AI quota.
CREATE TABLE IF NOT EXISTS chat_answer_cache (
    cache_key CHAR(64) NOT NULL,
    payload TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (cache_key),
    KEY idx_chat_answer_cache_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
