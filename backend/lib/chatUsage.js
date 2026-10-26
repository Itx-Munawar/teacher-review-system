// Review-assistant usage counters and answer ratings.
//
// Usage: daily counters only (how many questions, in which language, about
// which aspect/teacher/course). The text of a question is never stored here.
//
// Ratings: when a student taps 👍/👎 under an answer, that question and answer
// are stored so an admin can see what the assistant gets wrong. The widget
// says so next to the buttons. The answer comes back from the browser, so it
// carries an HMAC "reply token" issued with the answer: a rating can only be
// stored for a question/answer pair this server actually produced.

const crypto = require('crypto');
const db = require('../db');
const state = require('../state');
const { JWT_SECRET } = require('../config');
const { logJson } = require('./log');

const USAGE_RETENTION_DAYS = 90;
const FEEDBACK_RETENTION_DAYS = 90;
const REPLY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_QUESTION_CHARS = 600;
const MAX_ANSWER_CHARS = 6000;
const MAX_COMMENT_CHARS = 500;

// A key of its own, derived from the server secret, so a reply token can never
// be confused with (or used as) any other signed value.
const TOKEN_KEY = crypto.createHmac('sha256', String(JWT_SECRET || 'dev-only')).update('chat-reply-token-v1').digest();

const sha = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const teacherIdList = (ids) => [...new Set((Array.isArray(ids) ? ids : [])
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0))]
    .slice(0, 6)
    .sort((a, b) => a - b);

const replyMac = (issuedAt, question, answer, teacherIds) => crypto
    .createHmac('sha256', TOKEN_KEY)
    .update(`${issuedAt}\n${sha(question)}\n${sha(answer)}\n${teacherIdList(teacherIds).join(',')}`)
    .digest('base64url');

const signReply = ({ question, answer, teacherIds = [], now = Date.now() }) => {
    const issuedAt = Math.floor(now / 1000);
    return `${issuedAt}.${replyMac(issuedAt, question, answer, teacherIds)}`;
};

const verifyReply = ({ token, question, answer, teacherIds = [], now = Date.now() }) => {
    const match = /^(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(String(token || ''));
    if (!match) return false;
    const issuedAt = Number(match[1]);
    const age = now - issuedAt * 1000;
    if (age < -60 * 1000 || age > REPLY_TOKEN_TTL_MS) return false;
    const expected = Buffer.from(replyMac(issuedAt, question, answer, teacherIds));
    const given = Buffer.from(match[2]);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
};

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Count one chat request. `entries` is a list of [metric, key] pairs, e.g.
 * [['request', 'answered'], ['lang', 'roman-urdu'], ['aspect', 'grading']].
 * Fire-and-forget: a failure here must never affect the answer.
 */
const recordUsage = (entries) => {
    if (!state.chatUsageReady) return;
    const day = today();
    const rows = entries
        .filter(([metric, key]) => metric && key !== undefined && key !== null && String(key) !== '')
        .map(([metric, key]) => [day, String(metric).slice(0, 24), String(key).slice(0, 120)]);
    if (!rows.length) return;
    db.query(
        `INSERT INTO chat_usage_daily (day, metric, mkey, count) VALUES ${rows.map(() => '(?, ?, ?, 1)').join(', ')}
         ON DUPLICATE KEY UPDATE count = count + 1`,
        rows.flat()
    ).catch((error) => console.error('Chat usage log error:', error.message));
};

const pruneChatData = async () => {
    if (!state.chatUsageReady) return;
    try {
        const usageCutoff = new Date(Date.now() - USAGE_RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
        const feedbackCutoff = new Date(Date.now() - FEEDBACK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
        const [usage] = await db.query('DELETE FROM chat_usage_daily WHERE day < ?', [usageCutoff]);
        const [feedback] = await db.query('DELETE FROM chat_feedback WHERE created_at < ?', [feedbackCutoff]);
        if (usage.affectedRows || feedback.affectedRows) {
            logJson('info', 'chat_data_pruned', { usage: usage.affectedRows, feedback: feedback.affectedRows });
        }
    } catch (error) {
        console.error('Chat data prune error:', error.message);
    }
};

module.exports = {
    USAGE_RETENTION_DAYS,
    FEEDBACK_RETENTION_DAYS,
    MAX_QUESTION_CHARS,
    MAX_ANSWER_CHARS,
    MAX_COMMENT_CHARS,
    teacherIdList,
    signReply,
    verifyReply,
    recordUsage,
    pruneChatData,
    sha
};
