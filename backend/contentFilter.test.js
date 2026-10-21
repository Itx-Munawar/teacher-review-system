/**
 * Tests for the NLP content filter (backend/contentFilter.js).
 * Run: cd backend && node --test
 *
 * Covers: strong/contextual flagging, English + Roman-Urdu lexicons,
 * POS/casing context exemptions, and evasion handling (leetspeak,
 * masked vowels, repeated letters, split letters, split words).
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { detectFlaggedText, detectSensitiveAllegation, moderationFlagFor, sweepExistingReviews, sweepExistingQa, parseCourseList } = require('./contentFilter');

const isFlagged = (text) => detectFlaggedText(text).flagged;

// ---------------------------------------------------------------------------
// Clean text must pass
// ---------------------------------------------------------------------------

test('clean review text passes', () => {
    const clean = 'The teacher explains concepts clearly and is always on time. Highly recommended for CS students.';
    assert.strictEqual(isFlagged(clean), false);
});

test('empty and non-string inputs pass safely', () => {
    assert.strictEqual(isFlagged(''), false);
    assert.strictEqual(isFlagged('   '), false);
    assert.strictEqual(isFlagged(null), false);
    assert.strictEqual(isFlagged(undefined), false);
});

test('Scunthorpe-type false positives never match (substring safety)', () => {
    assert.strictEqual(isFlagged('Scunthorpe is a city'), false);
    assert.strictEqual(isFlagged('the class was good'), false);
    assert.strictEqual(isFlagged('I assessed my progress'), false);
    assert.strictEqual(isFlagged('an assassin in the game'), false);
    assert.strictEqual(isFlagged('the course covers recursion and classes'), false);
});

// ---------------------------------------------------------------------------
// English strong terms (any POS, always flagged)
// ---------------------------------------------------------------------------

test('flags strong English profanity', () => {
    assert.strictEqual(isFlagged('this fucking professor is a bitch'), true);
    assert.strictEqual(isFlagged('what a load of bullshit'), true);
    assert.strictEqual(isFlagged('wtf is this exam'), true);
});

test('flags inflected forms via suffix stemming', () => {
    assert.strictEqual(isFlagged('fucking'), true);   // -ing
    assert.strictEqual(isFlagged('fucked'), true);    // -ed
    assert.strictEqual(isFlagged('fucker'), true);    // -er
    assert.strictEqual(isFlagged('shitty'), true);    // -y + de-double
    assert.strictEqual(isFlagged('bitches'), true);   // -es
});

// ---------------------------------------------------------------------------
// Roman Urdu (strong and mild), always flagged — no POS gating
// ---------------------------------------------------------------------------

test('flags serious Roman-Urdu abuse', () => {
    assert.strictEqual(isFlagged('bhenchod teacher'), true);
    assert.strictEqual(isFlagged('kutta teacher hai'), true);
    assert.strictEqual(isFlagged('harami aadmi'), true);
    assert.strictEqual(isFlagged('you are a chutiya'), true);
    assert.strictEqual(isFlagged('randi'), true);
    assert.strictEqual(isFlagged('gandu'), true);
});

test('flags mild Roman-Urdu insults (queued for admin)', () => {
    assert.strictEqual(isFlagged('bakwas teacher'), true);
    assert.strictEqual(isFlagged('gadha exam tha'), true);
    assert.strictEqual(isFlagged('nalayak professor'), true);
    assert.strictEqual(isFlagged('bewakoof student'), true);
});

test('clean Roman Urdu passes', () => {
    assert.strictEqual(isFlagged('bohat acha teacher hai'), false);
    assert.strictEqual(isFlagged('mujhe ye course pasand hai'), false);
});

// ---------------------------------------------------------------------------
// POS / casing context exemptions (English contextual words)
// ---------------------------------------------------------------------------

test('contextual words flagged in offensive usage', () => {
    assert.strictEqual(isFlagged('go to hell'), true);
    assert.strictEqual(isFlagged('damn it'), true);
    assert.strictEqual(isFlagged('you are a dick'), true);
    assert.strictEqual(isFlagged('what a dick'), true);
});

test('contextual words exempt as proper nouns (POS context)', () => {
    assert.strictEqual(isFlagged("Hell's Kitchen restaurant"), false);
});

test('contextual words exempt when title-cased (name context)', () => {
    assert.strictEqual(isFlagged('Dick'), false);
    assert.strictEqual(isFlagged('Dick is my friend'), false);
});

// ---------------------------------------------------------------------------
// Evasion handling
// ---------------------------------------------------------------------------

test('flags leetspeak', () => {
    assert.strictEqual(isFlagged('sh1t this course'), true);
    assert.strictEqual(isFlagged('bhench0d'), true);
});

test('flags masked-vowel tokens via skeleton matching', () => {
    assert.strictEqual(isFlagged('f*ck this exam'), true);
    assert.strictEqual(isFlagged('b*tch'), true);
});

test('flags repeated-letter obfuscation', () => {
    assert.strictEqual(isFlagged('fuuuuck this'), true);
    assert.strictEqual(isFlagged('shiiit'), true);
});

test('flags split-letter obfuscation', () => {
    assert.strictEqual(isFlagged('f u c k this'), true);
    assert.strictEqual(isFlagged('s h i t'), true);
});

test('flags split-word phrases (adjacent term reassembly)', () => {
    assert.strictEqual(isFlagged('bhen chod kar'), true);
    assert.strictEqual(isFlagged('madar chod'), true);
    assert.strictEqual(isFlagged('bull shit'), true);
});

// ---------------------------------------------------------------------------
// Match metadata
// ---------------------------------------------------------------------------

test('matches carry kind and token context', () => {
    const r = detectFlaggedText('sh1t and bhen chod here');
    assert.strictEqual(r.flagged, true);
    assert.ok(r.matches.length >= 2);
    const kinds = r.matches.map((m) => m.kind);
    assert.ok(kinds.includes('strong'), 'expected strong match');
    assert.ok(kinds.includes('phrase'), 'expected phrase match');
    for (const m of r.matches) {
        assert.ok(m.entry && m.token && m.kind, 'match fields present');
    }
});

// ---------------------------------------------------------------------------
// Retroactive sweep over existing reviews
// ---------------------------------------------------------------------------

const sweepRows = () => [
    { id: 1, comment: 'fucking terrible course', user_name: 'A', courses: null, is_approved: 1 }, // flags -> queue
    { id: 2, comment: 'clear explanations, helpful', user_name: 'B', courses: null, is_approved: 1 }, // clean -> untouched
    { id: 3, comment: 'kutta teacher', user_name: 'C', courses: null, is_approved: 0 }, // flagged, already queued
    { id: 4, comment: 'good lectures', user_name: 'D', courses: '["bhen chod"]', is_approved: 1 }, // flags via courses
    { id: 5, comment: 'rejected earlier by admin', user_name: 'E', courses: null, is_approved: 0 } // clean, manually held
];

const makeDb = (rows, updates) => ({
    query: async (sql) => {
        if (sql.includes('FROM reviews')) return [rows, []];
        updates.push(sql);
        return [{ affectedRows: 0 }, []];
    }
});

test('sweep queues flagged approved reviews and never loosens others', async () => {
    const updates = [];
    const result = await sweepExistingReviews(makeDb(sweepRows(), updates));

    assert.strictEqual(result.scanned, 5);
    assert.strictEqual(result.toQueue, 2);
    assert.deepStrictEqual(result.flaggedIds, [1, 4]);
    assert.strictEqual(result.alreadyQueued, 1); // id 3 only
    assert.strictEqual(updates.length, 1, 'one chunked UPDATE');
    assert.ok(updates[0].includes('SET is_approved = 0'), 'only tightens to 0');
    assert.ok(!updates[0].includes('is_approved = 1'), 'never writes 1');
});

test('sweep dryRun previews without writing', async () => {
    const updates = [];
    const result = await sweepExistingReviews(makeDb(sweepRows(), updates), { dryRun: true });

    assert.strictEqual(result.toQueue, 2);
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(updates.length, 0, 'no UPDATE on dry run');
});

test('sweep is idempotent once rows are queued', async () => {
    const rows = [
        { id: 1, comment: 'fucking terrible', user_name: 'A', courses: null, is_approved: 0 },
        { id: 2, comment: 'still great', user_name: 'B', courses: null, is_approved: 1 }
    ];
    const updates = [];
    const result = await sweepExistingReviews(makeDb(rows, updates));

    assert.strictEqual(result.toQueue, 0, 'nothing new to queue');
    assert.strictEqual(result.alreadyQueued, 1);
    assert.strictEqual(updates.length, 0, 'no writes on second run');
});

test('parseCourseList handles JSON, legacy text, null and junk', () => {
    assert.deepStrictEqual(parseCourseList('["Math", " Physics "]'), ['Math', 'Physics']);
    assert.deepStrictEqual(parseCourseList('null'), []);
    assert.deepStrictEqual(parseCourseList(null), []);
    assert.deepStrictEqual(parseCourseList('["bhen chod"]'), ['bhen chod']);
    assert.deepStrictEqual(parseCourseList('Legacy Course'), ['Legacy Course']);
});

// ---------------------------------------------------------------------------
// Retroactive Q&A / custom-course sweep
// ---------------------------------------------------------------------------

const qaData = () => ({
    questions: [
        { id: 11, question: 'fucking impossible exam?', is_approved: 1 }, // flags -> queue
        { id: 12, question: 'is the final cumulative?', is_approved: 1 }, // clean
        { id: 13, question: 'kutta teacher?', is_approved: 0 } // flagged, already queued
    ],
    answers: [
        { id: 21, answer: 'this guy is a bastard', is_approved: 1 }, // flags -> queue
        { id: 22, answer: 'yes, week 6 onward', is_approved: 1 } // clean
    ],
    courses: [
        { id: 31, name: 'bhen chod 101', status: 'approved' }, // flags -> demote
        { id: 32, name: 'Calculus I', status: 'approved' }, // clean
        { id: 33, name: 'bakwas course', status: 'pending' }, // flagged, already pending
        { id: 34, name: 'gandu studies', status: 'rejected' } // flagged, rejected stays
    ]
});

const makeQaDb = (data, updates) => ({
    query: async (sql) => {
        if (sql.startsWith('SELECT')) {
            if (sql.includes('question_answers')) return [data.answers, []];
            if (sql.includes('FROM questions')) return [data.questions, []];
            if (sql.includes('custom_courses')) return [data.courses, []];
        }
        updates.push(sql);
        return [{ affectedRows: 0 }, []];
    }
});

test('Q&A sweep tightens only: queues flagged, keeps rejected, demotes approved courses', async () => {
    const updates = [];
    const result = await sweepExistingQa(makeQaDb(qaData(), updates));

    assert.deepStrictEqual(
        { toQueue: result.questions.toQueue, already: result.questions.alreadyQueued, ids: result.questions.flaggedIds },
        { toQueue: 1, already: 1, ids: [11] }
    );
    assert.deepStrictEqual(
        { toQueue: result.answers.toQueue, ids: result.answers.flaggedIds },
        { toQueue: 1, ids: [21] }
    );
    assert.deepStrictEqual(
        { demote: result.courses.toDemote, already: result.courses.alreadyPending, ids: result.courses.flaggedIds },
        { demote: 1, already: 1, ids: [31] }
    );

    assert.strictEqual(updates.length, 3, 'one UPDATE per affected table');
    assert.ok(updates[0].includes('UPDATE questions SET is_approved = 0'), 'questions tighten to 0');
    assert.ok(updates[1].includes('UPDATE question_answers SET is_approved = 0'), 'answers tighten to 0');
    assert.ok(updates[2].includes("UPDATE custom_courses SET status = 'pending'"), 'courses demote to pending');
    assert.ok(!updates.some((u) => u.includes('= 1')), 'never writes 1');
});

test('Q&A sweep dryRun previews without writing', async () => {
    const updates = [];
    const result = await sweepExistingQa(makeQaDb(qaData(), updates), { dryRun: true });

    assert.strictEqual(result.questions.toQueue, 1);
    assert.strictEqual(result.answers.toQueue, 1);
    assert.strictEqual(result.courses.toDemote, 1);
    assert.strictEqual(result.dryRun, true);
    assert.strictEqual(updates.length, 0, 'no UPDATE on dry run');
});

test('Q&A sweep is idempotent once rows are queued', async () => {
    const data = {
        questions: [{ id: 1, question: 'shit exam', is_approved: 0 }],
        answers: [{ id: 2, answer: 'damn hard', is_approved: 0 }],
        courses: [{ id: 3, name: 'chutiya course', status: 'pending' }]
    };
    const updates = [];
    const result = await sweepExistingQa(makeQaDb(data, updates));

    assert.strictEqual(result.questions.toQueue, 0);
    assert.strictEqual(result.answers.toQueue, 0);
    assert.strictEqual(result.courses.toDemote, 0);
    assert.strictEqual(updates.length, 0, 'no writes on second run');
});

// ---------------------------------------------------------------------------
// Sensitive-allegation triage
// ---------------------------------------------------------------------------

test('ordinary praise is not sensitive', () => {
    const { sensitive } = detectSensitiveAllegation('Great teacher, explains everything clearly.');
    assert.strictEqual(sensitive, false);
});

test('plain criticism is not sensitive', () => {
    const { sensitive } = detectSensitiveAllegation('Strict grader and the lectures are boring.');
    assert.strictEqual(sensitive, false);
});

test('harassment allegations are sensitive', () => {
    const { sensitive, categories } = detectSensitiveAllegation('He says very inappropriate things to students.');
    assert.strictEqual(sensitive, true);
    assert.ok(categories.includes('harassment'));
});

test('threats tied to grades are sensitive', () => {
    const { sensitive, categories } = detectSensitiveAllegation('She threatened to fail me if I did not comply.');
    assert.strictEqual(sensitive, true);
    assert.ok(categories.includes('threats'));
});

test('gender + conduct combination is sensitive', () => {
    const { sensitive, categories } = detectSensitiveAllegation('He discusses girls personal life in class.');
    assert.strictEqual(sensitive, true);
    assert.ok(categories.includes('conduct'));
});

test('conduct words without a gender reference stay unflagged', () => {
    const { sensitive } = detectSensitiveAllegation('He never shares his personal life, very professional.');
    assert.strictEqual(sensitive, false);
});

test('word boundaries prevent false positives', () => {
    const { sensitive } = detectSensitiveAllegation('The harassment chapter of the law course was interesting.');
    assert.strictEqual(sensitive, true, 'the word itself is still an allegation term');

    const clean = detectSensitiveAllegation('The class discussed threatening behaviour in novels.');
    assert.strictEqual(clean.sensitive, true, 'flagged for human review, not blocked');
});

test('moderationFlagFor prioritises sensitive over everything else', () => {
    assert.strictEqual(moderationFlagFor('He harassed girls and used abusive language.'), 'sensitive');
});

test('moderationFlagFor marks gender bias', () => {
    assert.strictEqual(moderationFlagFor('Full favoritism, he only favours girls.'), 'bias');
});

test('moderationFlagFor marks profanity', () => {
    assert.strictEqual(moderationFlagFor('This class is bullshit.'), 'profanity');
});

test('moderationFlagFor returns null for clean reviews', () => {
    assert.strictEqual(moderationFlagFor('Very helpful, answers every question patiently.'), null);
});
