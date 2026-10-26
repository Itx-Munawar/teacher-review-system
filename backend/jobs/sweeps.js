// One-time retroactive content-filter sweeps over existing reviews and Q&A.

const db = require('../db');
const { createAuditLog } = require('../lib/audit');
const { moderationFlagFor, sweepExistingReviews, sweepExistingQa } = require('../contentFilter');
const state = require('../state');
const { invalidateCache } = require('../lib/cache');

// Hand the event loop a turn between expensive batches so a long sweep does
// not freeze every other request (and the platform health check).
const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

// ========== ONE-TIME RETROACTIVE REVIEW FILTER SWEEP ==========
// Runs the NLP content filter over reviews that existed before the filter
// was added: flagged approved reviews are queued for admin moderation.
// Gated by an audit_logs marker so it runs once (not on every boot); the
// admin endpoint POST /api/admin/filter-reviews re-runs it explicitly.
let reviewSweepAttempts = 0;

const runReviewFilterSweep = async () => {
    if (state.reviewSweepDone) return;
    try {
        const [marker] = await db.query("SELECT id FROM audit_logs WHERE action = 'SWEEP_REVIEWS' LIMIT 1");
        if (marker.length > 0) {
            state.reviewSweepDone = true;
            return;
        }
        const result = await sweepExistingReviews(db);
        if (result.toQueue > 0) invalidateCache('teachers');
        state.reviewSweepDone = true;
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

const runQaFilterSweep = async () => {
    if (state.qaSweepDone) return;
    try {
        const [marker] = await db.query("SELECT id FROM audit_logs WHERE action = 'SWEEP_QA' LIMIT 1");
        if (marker.length > 0) {
            state.qaSweepDone = true;
            return;
        }
        const result = await sweepExistingQa(db);
        state.qaSweepDone = true;
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
// Versioned: bump SENSITIVE_BACKFILL_VERSION when the lexicon improves so the
// already-processed rows are re-scanned exactly once.
const SENSITIVE_BACKFILL_VERSION = 2;
let sensitiveBackfillAttempts = 0;
let sensitiveBackfillDone = false;

const runSensitiveReviewBackfill = async () => {
    if (sensitiveBackfillDone || !state.reviewModerationColumnReady) return;
    try {
        const [marker] = await db.query(
            "SELECT id, details FROM audit_logs WHERE action = 'FLAG_SENSITIVE_REVIEWS' ORDER BY id DESC LIMIT 1"
        );
        if (marker.length > 0) {
            let appliedVersion = 1;
            try {
                appliedVersion = Number(JSON.parse(marker[0].details || '{}').version) || 1;
            } catch (parseErr) {
                appliedVersion = 1;
            }
            if (appliedVersion >= SENSITIVE_BACKFILL_VERSION) {
                sensitiveBackfillDone = true;
                return;
            }
        }

        const BATCH = 500;
        let lastId = 0;
        let scanned = 0;
        const flaggedIds = [];
        for (;;) {
            const [rows] = await db.query(
                `SELECT id, comment, user_name, courses FROM reviews
                 WHERE id > ? AND (moderation_flag IS NULL OR moderation_flag <> 'sensitive')
                 ORDER BY id ASC LIMIT ?`,
                [lastId, BATCH]
            );
            if (rows.length === 0) break;
            scanned += rows.length;
            lastId = Number(rows[rows.length - 1].id);
            for (const row of rows) {
                const text = `${row.comment || ''} ${row.user_name || ''} ${row.courses || ''}`;
                if (moderationFlagFor(text) === 'sensitive') flaggedIds.push(row.id);
            }
            if (rows.length < BATCH) break;
            await yieldToEventLoop();
        }
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
            [JSON.stringify({ version: SENSITIVE_BACKFILL_VERSION, scanned, flagged: flaggedIds.length })]
        );
        console.log(`🔎 Sensitive-review backfill v${SENSITIVE_BACKFILL_VERSION}: scanned ${scanned}, flagged ${flaggedIds.length}`);
    } catch (error) {
        sensitiveBackfillAttempts += 1;
        console.error('❌ Sensitive-review backfill failed:', error.message);
        if (sensitiveBackfillAttempts < 10) setTimeout(runSensitiveReviewBackfill, 30000);
    }
};

// Tidies teacher rows written before names and departments were normalised:
// stray/double spaces ("Dr  Nosheen Qamar") and a school typed as its short
// form ("SST" next to 289 rows of "School of Systems and Technology"), which
// showed up as its own one-teacher department filter. Idempotent and cheap
// (one SELECT of ~1000 short rows), so it simply runs on every boot and only
// writes rows that actually change.
const runTeacherTidySweep = async () => {
    try {
        const { normalizeTeacherName, normalizeDepartment, departmentForAcronym } = require('../lib/content');
        const [rows] = await db.query('SELECT id, name, department FROM teachers');
        const departments = rows.map((r) => normalizeDepartment(r.department));
        const changes = [];
        for (const row of rows) {
            const name = normalizeTeacherName(row.name);
            let department = normalizeDepartment(row.department);
            department = departmentForAcronym(department, departments) || department;
            if (name.length >= 2 && department.length >= 2 && (name !== row.name || department !== row.department)) {
                changes.push({ id: row.id, name, department, before: `${row.name} / ${row.department}` });
            }
        }
        for (const change of changes) {
            await db.query('UPDATE teachers SET name = ?, department = ? WHERE id = ?', [change.name, change.department, change.id]);
        }
        if (changes.length > 0) {
            const details = changes
                .map((c) => `#${c.id} "${c.before}" -> "${c.name} / ${c.department}"`)
                .join('; ')
                .slice(0, 1000);
            await createAuditLog(null, 'TIDY_TEACHERS', `Normalised ${changes.length} teacher row(s): ${details}`, 'system');
            invalidateCache('teachers');
            console.log(`🧹 Tidied ${changes.length} teacher row(s)`);
        }
        return changes.length;
    } catch (error) {
        console.error('⚠️ Teacher tidy sweep failed:', error.message);
        return 0;
    }
};

module.exports = {
    runTeacherTidySweep,
    yieldToEventLoop,
    runReviewFilterSweep,
    runQaFilterSweep,
    SENSITIVE_BACKFILL_VERSION,
    runSensitiveReviewBackfill
};
