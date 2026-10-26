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
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_reviews_teacher (teacher_id, is_approved),
    KEY idx_reviews_created (created_at),
    CONSTRAINT fk_reviews_teacher FOREIGN KEY (teacher_id) REFERENCES teachers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reader reports on published reviews. reporter_hash is a salted hash of the
-- reporter's address so one client cannot file the same report twice; the raw
-- address is never stored.
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
