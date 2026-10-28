// AI summary of a teacher's approved reviews, in Roman Urdu.
//
// A summary is generated once and saved in teacher_summaries. It is shown
// as-is until a NEW review is approved (the signature is the newest approved
// review id), so page views and review edits cost no AI quota at all.
// Failures back off per teacher so a busy Gemini is not asked on every visit.

const crypto = require('crypto');
const db = require('../db');
const state = require('../state');
const gemini = require('./gemini');
const { parseCourseList } = require('../contentFilter');
const { logJson } = require('./log');
const { romanUrduShare, hasForeignLetters } = require('./chatKnowledge');

const MIN_REVIEWS = 3;
const MAX_REVIEWS_IN_PROMPT = 150;
const MAX_CHARS_IN_PROMPT = 40000;
const DAILY_LIMIT = () => Math.max(0, parseInt(process.env.SUMMARY_PER_DAY, 10) || 150);

// After a failed attempt, wait before asking Gemini again for that teacher.
const RETRY_AFTER_FAILURE_MS = () => Math.max(0, parseInt(process.env.SUMMARY_RETRY_AFTER_MS, 10) || 15 * 60 * 1000);
const inFlight = new Map(); // teacherId -> Promise
const lastFailure = new Map(); // teacherId -> ms timestamp
let budget = { day: '', used: 0 };

const takeBudget = () => {
    const day = new Date().toISOString().slice(0, 10);
    if (budget.day !== day) budget = { day, used: 0 };
    if (budget.used >= DAILY_LIMIT()) return false;
    budget.used += 1;
    return true;
};

const SYSTEM_PROMPT = `You summarise anonymous student reviews of one university teacher for "UMT Teacher Reviews" (University of Management and Technology, Lahore).

LANGUAGE (most important): write ONLY in Roman Urdu (Urdu written in English letters), the way Pakistani students text: simple, natural, short sentences. This applies even when every review is written in English - translate the meaning into Roman Urdu. Never write whole sentences in English. English words for things like grading, quizzes, assignments, attendance, concepts are fine inside Roman Urdu sentences.
Example of the right style: "Zyada tar students kehte hain ke concepts clear karte hain aur grading fair hai." Wrong: "Most students say he explains concepts clearly." 

Rules:
- Use ONLY what the reviews say. Never invent facts, numbers or courses.
- Reflect the balance of opinion honestly: if most reviews are positive, say so; mention a concern only if more than one review raises it, or say "kuch students" when it is a minority view.
- Never name or quote reviewers. Never include phone numbers, emails or personal details.
- Do not repeat serious personal allegations (harassment, misconduct, discrimination). If such complaints exist, at most write "Kuch reviews mein rawaiye (behaviour) ke baare mein concerns hain."
- Be fair and respectful to the teacher. No insults, no exaggeration.
- Ignore reviews that are only "good", "best" etc. except to count them as general praise.

Return ONLY a JSON object, no markdown:
{"overview": "1-2 sentences overall picture", "pros": ["2-4 short points students like"], "cons": ["0-3 short points students find difficult"]}
Each point is at most 15 words. Use an empty array if there is nothing real to say.`;

// The newest approved review id: changes only when a new review is approved
// (or the newest one is removed). Edits to older reviews do not regenerate.
const signatureFor = (reviews) => `n:${reviews.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0)}`;
// Signatures written before this scheme (sha1 of every review id + length).
const LEGACY_SIGNATURE = /^[0-9a-f]{40}$/;

/**
 * True when every sentence of the summary reads as Roman Urdu. Checked line by
 * line: a Roman Urdu pros list must not hide an English overview. Very short
 * lines ("Grading fair") are skipped - they are fine either way.
 */
const isRomanUrdu = (parsed) => {
    const lines = [parsed.overview, ...parsed.pros, ...parsed.cons].map((line) => String(line || ''));
    // The model sometimes slips one word into another script ("આંkhain band kar ke").
    if (lines.some(hasForeignLetters)) return false;
    return lines
        .filter((line) => (line.match(/[a-z]+/gi) || []).length >= 5)
        .every((line) => romanUrduShare(line) >= 0.1);
};

const TRANSLATE_PROMPT = `Rewrite this JSON so every string is in Roman Urdu (Urdu written in English letters only, the way Pakistani students text; no Urdu, Hindi or other scripts). Keep the meaning and the same keys. English words like grading, quizzes, assignments, attendance are fine inside Roman Urdu sentences. Return ONLY the JSON.`;

/** Cheap fix for an English summary: translate the short JSON (no reviews). */
const translateToRomanUrdu = async (parsed) => {
    try {
        const fixed = await gemini.generate({
            system: TRANSLATE_PROMPT,
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(parsed) }] }],
            maxOutputTokens: 600,
            temperature: 0.2,
            responseMimeType: 'application/json'
        });
        // eslint-disable-next-line no-use-before-define
        const translated = parseSummary(fixed.text);
        return translated && isRomanUrdu(translated) ? translated : null;
    } catch (_) {
        return null;
    }
};

const clean = (text, max) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);

/** Parse and validate the model's JSON; returns null when unusable. */
const parseSummary = (raw) => {
    if (!raw) return null;
    let text = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    text = text.slice(start, end + 1);
    let data;
    try { data = JSON.parse(text); } catch (_) { return null; }
    const overview = clean(data && data.overview, 400);
    const list = (v, n) => (Array.isArray(v) ? v : []).map((x) => clean(x, 180)).filter(Boolean).slice(0, n);
    const pros = list(data && data.pros, 4);
    const cons = list(data && data.cons, 3);
    if (!overview && pros.length === 0) return null;
    return { overview, pros, cons };
};

const buildPrompt = (teacher, reviews) => {
    let used = 0;
    const lines = [];
    for (const r of reviews) {
        const courses = parseCourseList(r.courses);
        const line = `- ${courses.length ? `[${courses.join(', ')}] ` : ''}${clean(r.comment, 1000)}`;
        if (used + line.length > MAX_CHARS_IN_PROMPT) break;
        used += line.length;
        lines.push(line);
    }
    return `Teacher: ${teacher.name} (${teacher.department || 'UMT'})
Number of approved reviews: ${reviews.length}

Reviews (newest first):
${lines.join('\n')}`;
};

const readCached = async (teacherId) => {
    const [rows] = await db.query('SELECT summary, signature, review_count, generated_at FROM teacher_summaries WHERE teacher_id = ?', [teacherId]);
    if (rows.length === 0) return null;
    const parsed = parseSummary(rows[0].summary);
    return parsed ? { ...rows[0], parsed } : null;
};

const respond = (row, extra = {}) => ({
    available: true,
    ...row.parsed,
    review_count: row.review_count,
    generated_at: row.generated_at,
    ...extra
});

/**
 * @returns {Promise<object>} { available: true, overview, pros, cons, review_count, generated_at, stale? }
 *   or { available: false, reason: 'disabled' | 'few_reviews' | 'busy' | 'not_found' }
 */
const getTeacherSummary = async (teacherId) => {
    if (!state.teacherSummariesReady || !gemini.isConfigured()) return { available: false, reason: 'disabled' };

    const [teachers] = await db.query('SELECT id, name, department FROM teachers WHERE id = ?', [teacherId]);
    if (teachers.length === 0) return { available: false, reason: 'not_found' };

    const [reviews] = await db.query(
        `SELECT id, comment, courses FROM reviews
         WHERE teacher_id = ? AND is_approved = 1
         ORDER BY created_at DESC, id DESC LIMIT ?`,
        [teacherId, MAX_REVIEWS_IN_PROMPT]
    );
    if (reviews.length < MIN_REVIEWS) return { available: false, reason: 'few_reviews', min_reviews: MIN_REVIEWS };

    const signature = signatureFor(reviews);
    const cached = await readCached(teacherId);
    const recentlyFailed = () => {
        const at = lastFailure.get(teacherId);
        return Boolean(at && Date.now() - at < RETRY_AFTER_FAILURE_MS());
    };

    if (cached && cached.signature === signature) {
        if (isRomanUrdu(cached.parsed) || recentlyFailed() || inFlight.has(teacherId)) return respond(cached);
        // Saved summary with English lines: translate it once (small call, no reviews).
        const job = (async () => {
            if (!takeBudget()) return respond(cached);
            const translated = await translateToRomanUrdu(cached.parsed);
            if (!translated) {
                lastFailure.set(teacherId, Date.now());
                return respond(cached);
            }
            await db.query('UPDATE teacher_summaries SET summary = ? WHERE teacher_id = ?', [JSON.stringify(translated), teacherId]);
            logJson('info', 'summary_translated', { teacher_id: teacherId });
            return respond({ ...cached, parsed: translated });
        })();
        inFlight.set(teacherId, job);
        try { return await job; } finally { inFlight.delete(teacherId); }
    }

    // One-time move from the old signature: a Roman Urdu summary of the same
    // reviews is kept (no AI call); only English ones are rebuilt.
    if (cached && LEGACY_SIGNATURE.test(cached.signature) && cached.review_count === reviews.length && isRomanUrdu(cached.parsed)) {
        await db.query('UPDATE teacher_summaries SET signature = ? WHERE teacher_id = ?', [signature, teacherId]);
        return respond(cached);
    }

    if (inFlight.has(teacherId)) return inFlight.get(teacherId);

    if (recentlyFailed()) {
        return cached ? respond(cached, { stale: true }) : { available: false, reason: 'busy' };
    }

    const job = (async () => {
        if (!takeBudget()) {
            return cached ? respond(cached, { stale: true }) : { available: false, reason: 'busy' };
        }
        try {
            const { text, model } = await gemini.generate({
                system: SYSTEM_PROMPT,
                contents: [{ role: 'user', parts: [{ text: buildPrompt(teachers[0], reviews) }] }],
                maxOutputTokens: 700,
                temperature: 0.3,
                responseMimeType: 'application/json'
            });
            let parsed = parseSummary(text);
            if (!parsed) {
                logJson('warn', 'summary_unparseable', { teacher_id: teacherId, model });
                lastFailure.set(teacherId, Date.now());
                return cached ? respond(cached, { stale: true }) : { available: false, reason: 'busy' };
            }
            if (!isRomanUrdu(parsed)) {
                // Cheap fix: translate the short JSON instead of re-sending every review.
                parsed = (await translateToRomanUrdu(parsed)) || parsed;
            }
            await db.query(
                `INSERT INTO teacher_summaries (teacher_id, summary, signature, review_count, model, generated_at)
                 VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON DUPLICATE KEY UPDATE summary = VALUES(summary), signature = VALUES(signature),
                    review_count = VALUES(review_count), model = VALUES(model), generated_at = CURRENT_TIMESTAMP`,
                [teacherId, JSON.stringify(parsed), signature, reviews.length, model]
            );
            lastFailure.delete(teacherId);
            logJson('info', 'summary_generated', { teacher_id: teacherId, reviews: reviews.length, model });
            return { available: true, ...parsed, review_count: reviews.length, generated_at: new Date().toISOString() };
        } catch (err) {
            logJson('warn', 'summary_failed', { teacher_id: teacherId, kind: err && err.kind, reason: String(err && err.message).slice(0, 200) });
            lastFailure.set(teacherId, Date.now());
            return cached ? respond(cached, { stale: true }) : { available: false, reason: 'busy' };
        }
    })();
    inFlight.set(teacherId, job);
    try {
        return await job;
    } finally {
        inFlight.delete(teacherId);
    }
};

const deleteTeacherSummary = async (teacherId) => {
    if (!state.teacherSummariesReady) return;
    await db.query('DELETE FROM teacher_summaries WHERE teacher_id = ?', [teacherId]);
};

module.exports = {
    getTeacherSummary,
    deleteTeacherSummary,
    parseSummary,
    MIN_REVIEWS,
    isRomanUrdu,
    _resetBudget: () => { budget = { day: '', used: 0 }; lastFailure.clear(); },
};
