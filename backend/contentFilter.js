/**
 * contentFilter.js — context-aware word filtering for user-submitted text.
 *
 * Uses the `compromise` NLP library for tokenization and part-of-speech (POS)
 * tagging, plus a lexicon of English and Roman-Urdu profanity/abuse terms.
 *
 * How context is used:
 *  - Whole-term matching (compromise's own tokenizer), never substring
 *    matching — so "Scunthorpe", "class", "assassin", "assessment" never hit.
 *  - POS context: English "weak" words (hell, damn, dick, ...) are only
 *    flagged when the tagger reads them as ordinary offensive usage
 *    (Noun/Verb/Expression/...), and are skipped when tagged as proper
 *    nouns — e.g. "Hell's Kitchen" passes, "go to hell" is flagged — or
 *    when the original surface word is title-cased ("Dick said hi" passes,
 *    "you are a dick" is flagged), covering cases the tagger misses.
 *    Serious terms and Roman-Urdu terms are always flagged (the English
 *    tagger is not reliable for Urdu transliterations, so no POS gating).
 *  - Evasion context: leetspeak (sh1t), masked vowels (f*ck), repeated
 *    letters (fuuuuck), split letters (f u c k), possessives (hell's) and
 *    word-splitting ("bhen chod" → "bhenchod") are normalized before
 *    matching; masked tokens are additionally matched by consonant skeleton.
 *
 * detectFlaggedText(text) -> { flagged, matches: [{ token, entry, kind, tags }] }
 * kind: 'strong' | 'contextual' | 'roman-urdu' | 'evasion' | 'phrase'
 */

const nlp = require('compromise');

// ---------------------------------------------------------------------------
// Lexicons
// ---------------------------------------------------------------------------

// English terms that are abusive in any usage — always flagged, no POS gate.
const EN_STRONG = new Set([
    'fuck', 'fucker', 'shit', 'bullshit', 'bastard', 'bitch', 'asshole',
    'motherfucker', 'whore', 'cunt', 'cock', 'slut', 'jackass', 'wtf', 'stfu',
    'rape', 'rapist'
]);

// English weak words: flagged only in offensive POS context (see gate below),
// exempt when the tagger reads them as proper nouns.
const EN_CONTEXTUAL = new Set([
    'hell', 'damn', 'damnit', 'crap', 'suck', 'sucks', 'piss', 'dick',
    'pussy', 'ass', 'arse'
]);

// Roman Urdu (Latin-script) abuse — serious terms, always flagged.
const RU_STRONG = new Set([
    'bhenchod', 'bhanchod', 'benchod', 'madarchod',
    'chutiya', 'chutya', 'chutiye', 'gandu', 'bhosdike', 'bhosdik',
    'randi', 'lund', 'phuddi', 'phudi', 'harami', 'haraami',
    'kamina', 'kamine', 'kameena', 'kameeni',
    'kutta', 'kutte', 'kutti'
]);

// Roman Urdu mild insults — Roman-Urdu entries are not POS-gated because the
// English tagger cannot classify transliterations reliably; they queue for
// admin review rather than block, so mildness is acceptable.
const RU_CONTEXTUAL = new Set([
    'bakwas', 'chawal', 'pagal', 'nalayak', 'gadha',
    'bewakoof', 'bekoof', 'bewaqoof', 'bekauf'
]);

// POS tags that indicate a proper noun / name / place — exempt only for
// English contextual entries.
const PROPER_TAGS = ['ProperNoun', 'Place', 'Person', 'Acronym', 'Organization', 'Uncountable'];

// Common English inflections: "fucking" → "fuck", "fucker" → "fuck".
const EN_SUFFIXES = ['s', 'es', 'ing', 'ed', 'er', 'ers', 'y'];

// Leetspeak / symbol substitutions.
const LEET_MAP = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', $: 's', '!': 'i', '+': 't' };

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const applyLeet = (s) => s.replace(/[013457@$!+]/g, (ch) => LEET_MAP[ch] || ch);

// Collapse runs of 3+ repeated letters: "fuuuuck" → "fuck", "shiiit" → "shit".
const collapseRuns = (s) => s.replace(/(.)\1{2,}/g, '$1');

// De-double pairs (fallback candidates only): "shitt" → "shit".
const deDouble = (s) => s.replace(/(.)\1/g, '$1');

// Consonant skeleton used only for masked tokens: "fck" → "fck".
const skeleton = (s) => s.replace(/[aeiou]/g, '');

// True when the raw term contained mask characters (non a-z after lowering).
const hasMask = (raw) => /[^a-z]/.test(raw);

/**
 * Build the candidate spellings for one raw (already lowercased) term.
 * Returns { plain, candidates, masked }.
 */
const buildCandidates = (raw) => {
    // Strip possessives first: "hell's" → "hell".
    const noPossessive = raw.replace(/'s$/, '');
    // Keep mask chars, digits and leet chars for now; drop everything else.
    const kept = noPossessive.replace(/[^a-z0-9@*$!#+]/g, '');
    const leeted = applyLeet(kept);
    const plain = leeted.replace(/[^a-z]/g, '');
    const collapsed = collapseRuns(plain);

    const candidates = new Set();
    const add = (w) => { if (w.length >= 2) candidates.add(w); };
    add(plain);
    add(collapsed);
    for (const base of [plain, collapsed]) {
        if (base.length < 3) continue;
        for (const suf of EN_SUFFIXES) {
            if (base.length - suf.length >= 3 && base.endsWith(suf)) {
                const stem = base.slice(0, -suf.length);
                add(stem);
                add(collapseRuns(stem));
                add(deDouble(stem));
            }
        }
    }
    add(deDouble(collapsed));

    return { plain: collapsed, candidates: [...candidates], masked: hasMask(kept) };
};

// Precomputed skeletons for masked-token matching (strong lists only).
const strongSkeletons = new Set([...EN_STRONG, ...RU_STRONG].map(skeleton));

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

const PROPER_CONTEXT_KIND = 'proper-noun-context';

/**
 * Match a single candidate against the lexicons, with POS gating for
 * English contextual entries.
 * @returns {object|null} match descriptor or null
 */
const matchCandidate = (candidate, tags, surface) => {
    if (EN_STRONG.has(candidate)) {
        return { entry: candidate, list: 'en-strong', kind: 'strong' };
    }
    if (RU_STRONG.has(candidate)) {
        return { entry: candidate, list: 'ru-strong', kind: 'roman-urdu' };
    }
    if (RU_CONTEXTUAL.has(candidate)) {
        return { entry: candidate, list: 'ru-contextual', kind: 'roman-urdu' };
    }
    if (EN_CONTEXTUAL.has(candidate)) {
        // POS context gate: skip when the tagger reads the term as a proper
        // noun ("Hell's Kitchen"), or when the surface form is title-cased in
        // the source text ("Dick" the name) — flag ordinary lowercase usage.
        const isProper = tags.some((t) => PROPER_TAGS.includes(t));
        const isTitleCase = /^[A-Z]/.test(surface || '');
        if (isProper || isTitleCase) return { entry: candidate, list: 'en-contextual', kind: PROPER_CONTEXT_KIND };
        return { entry: candidate, list: 'en-contextual', kind: 'contextual' };
    }
    return null;
};

/**
 * Detect profanity/abuse in one text using NLP tokenization, POS context
 * and evasion-resistant normalization.
 *
 * @param {string} text
 * @returns {{ flagged: boolean, matches: Array<{token:string, entry:string, kind:string, tags:string[]}> }}
 */
const detectFlaggedText = (text) => {
    const matches = [];
    if (!text || typeof text !== 'string' || text.trim() === '') {
        return { flagged: false, matches };
    }

    const doc = nlp(text);
    const paragraphs = doc.json({ terms: { text: true, tags: true, normal: true } });
    const terms = [];
    for (const p of paragraphs) {
        for (const t of p.terms || []) {
            terms.push({
                raw: String(t.normal || t.text || '').toLowerCase(),
                surface: String(t.text || t.normal || ''),
                tags: t.tags || []
            });
        }
    }

    const pushMatch = (m, token, tags) => {
        if (m.kind === PROPER_CONTEXT_KIND) return; // exempted by POS context
        if (matches.some((x) => x.entry === m.entry)) return; // dedupe
        matches.push({ token, entry: m.entry, kind: m.kind, tags });
    };

    // 1. Per-term matching with leet/mask/repeat normalization.
    for (const term of terms) {
        if (!term.raw) continue;
        const { plain, candidates, masked } = buildCandidates(term.raw);
        if (!plain) continue;
        for (const cand of candidates) {
            const m = matchCandidate(cand, term.tags, term.surface);
            if (m) { pushMatch(m, term.raw, term.tags); break; }
        }
        // Masked tokens ("f*ck", "f**k") — match consonant skeletons.
        if (masked) {
            for (const cand of candidates) {
                if (strongSkeletons.has(skeleton(cand))) {
                    pushMatch({ entry: cand, kind: 'evasion' }, term.raw, term.tags);
                    break;
                }
            }
        }
    }

    // 2. Phrase evasion: adjacent terms reassembled ("bhen chod" → "bhenchod",
    //    "bull shit" → "bullshit"). Strong lists only.
    for (let i = 0; i + 1 < terms.length; i++) {
        const a = buildCandidates(terms[i].raw).plain;
        const b = buildCandidates(terms[i + 1].raw).plain;
        if (!a || !b) continue;
        const joined = collapseRuns(a + b);
        if (EN_STRONG.has(joined) || RU_STRONG.has(joined)) {
            pushMatch({ entry: joined, kind: 'phrase' }, `${terms[i].raw} ${terms[i + 1].raw}`, terms[i].tags);
        }
    }

    // 3. Split-letter evasion: "f u c k" → four single-letter terms.
    let run = [];
    const flushRun = () => {
        if (run.length >= 4) {
            const joined = run.map((t) => buildCandidates(t.raw).plain).join('');
            if (EN_STRONG.has(joined) || RU_STRONG.has(joined)) {
                pushMatch({ entry: joined, kind: 'evasion' }, run.map((t) => t.raw).join(' '), run[0].tags);
            }
        }
        run = [];
    };
    for (const term of terms) {
        const plain = buildCandidates(term.raw).plain;
        if (/^[a-z]$/.test(plain)) run.push(term);
        else flushRun();
    }
    flushRun();

    return { flagged: matches.length > 0, matches };
};

// ---------------------------------------------------------------------------
// Sensitive-allegation detection
// ---------------------------------------------------------------------------
// Profanity filtering and allegation triage are different problems. A review
// can be perfectly polite while accusing a teacher of harassment, threatening
// grades, or targeting students by gender. Those rows are a legal and
// reputational risk and must reach an admin before they reach the public page.
//
// This detector never blocks a submission — every review is queued anyway.
// It only attaches a triage flag so the moderation queue can surface the rows
// that need a human decision first.

// Terms that are an allegation on their own, whatever else the text says.
const SENSITIVE_TERMS = {
    harassment: [
        'harass', 'harassed', 'harassing', 'harassment', 'inappropriate',
        'molest', 'molested', 'grope', 'groped', 'blackmail', 'blackmailed',
        'sexual', 'sexually', 'pervert', 'creepy', 'flirt', 'flirting',
        'uncomfortable', 'exploit', 'exploits', 'exploiting', 'taking advantage'
    ],
    threats: [
        'threat', 'threats', 'threaten', 'threatened', 'threatening',
        'dhamki', 'dhamka', 'intimidate', 'intimidated'
    ],
    violence: [
        'hit me', 'beat me', 'hits students', 'beats students', 'slap',
        'slapped', 'physically abused', 'physical abuse'
    ],
    substance: ['drunk', 'alcohol', 'drugs', 'nasha']
};

// Terms that only describe misconduct when the text also names a gender.
// "He discusses his personal life" is odd; "he discusses girls' personal
// lives" is an allegation.
const CONDUCT_TERMS = [
    'touch me', 'touched me', 'touches girls', 'touching girls',
    'comments on girls', 'personal life', 'family issues', 'appearance',
    'grades girls', 'grades boys', 'marks to girls', 'marks to boys'
];

const GENDER_TERMS = [
    'girl', 'girls', 'boy', 'boys', 'female', 'females', 'male', 'males',
    'ladies', 'lady', 'veil', 'hijab', 'appearance', 'looks', 'dressed'
];

// Unfairness claims: lower risk than misconduct, but worth triage.
const BIAS_TERMS = [
    'favoritism', 'favouritism', 'favorite', 'favourite', 'partial',
    'parcial', 'biased', 'bias'
];

const normaliseForMatch = (text) =>
    String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

const containsTerm = (haystack, term) => {
    if (!haystack) return false;
    if (term.includes(' ')) return haystack.includes(term);
    return new RegExp(`(^|\\s)${term}(\\s|$)`).test(haystack);
};

/**
 * Detect allegations that need human moderation before publication.
 *
 * @param {string} text
 * @returns {{sensitive: boolean, categories: string[], matches: string[]}}
 */
const detectSensitiveAllegation = (text) => {
    const haystack = normaliseForMatch(text);
    if (!haystack) return { sensitive: false, categories: [], matches: [] };

    const categories = new Set();
    const matches = new Set();

    for (const [category, terms] of Object.entries(SENSITIVE_TERMS)) {
        for (const term of terms) {
            if (containsTerm(haystack, term)) {
                categories.add(category);
                matches.add(term);
            }
        }
    }

    const hasGender = GENDER_TERMS.some((term) => containsTerm(haystack, term));
    if (hasGender) {
        for (const term of CONDUCT_TERMS) {
            if (containsTerm(haystack, term)) {
                categories.add('conduct');
                matches.add(term);
            }
        }
    }

    return { sensitive: categories.size > 0, categories: [...categories], matches: [...matches] };
};

/**
 * Triage flag stored on a review so the admin queue can sort by risk.
 * Priority: sensitive > bias > profanity > none.
 *
 * @param {string} text
 * @returns {'sensitive'|'bias'|'profanity'|null}
 */
const moderationFlagFor = (text) => {
    if (detectSensitiveAllegation(text).sensitive) return 'sensitive';

    const haystack = normaliseForMatch(text);
    const hasGender = GENDER_TERMS.some((term) => containsTerm(haystack, term));
    const hasBias = BIAS_TERMS.some((term) => containsTerm(haystack, term));
    if (hasGender && hasBias) return 'bias';

    if (detectFlaggedText(text).flagged) return 'profanity';
    return null;
};

/**
 * Parse a stored courses value (JSON string, legacy plain text, or Buffer)
 * into a clean array of course names.
 */
const parseCourseList = (raw) => {
    if (raw === null || raw === undefined) return [];
    const str = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
    if (!str || str === 'null' || str === '[]') return [];
    try {
        const parsed = JSON.parse(str);
        return (Array.isArray(parsed) ? parsed : [parsed]).map((c) => String(c).trim()).filter(Boolean);
    } catch (error) {
        const fallback = str.trim();
        return fallback ? [fallback] : [];
    }
};

/**
 * Run the NLP content filter over every review already stored in the
 * database (retroactive moderation for rows created before the filter
 * existed).
 *
 * Only ever TIGHTENS moderation: an approved review that flags is queued
 * (is_approved = 0). Clean rows are never touched, so manually rejected
 * or pending reviews are never auto-approved, and re-running is safe.
 *
 * @param {{query: Function}} db mysql2 promise pool (or a compatible mock)
 * @param {{dryRun?: boolean}} options preview without updating anything
 * @returns {Promise<{scanned: number, toQueue: number, alreadyQueued: number,
 *                    flaggedIds: number[], dryRun: boolean}>}
 */
// Scan large tables keyset-style instead of `SELECT *`-ing the whole thing into
// memory at once. Every sweep row has a numeric id, so `id > lastId` is both
// index-friendly and stable while rows are being updated.
const SWEEP_BATCH_SIZE = 500;

const yieldToEventLoop = () => new Promise((resolve) => setImmediate(resolve));

const forEachRowBatch = async (db, columns, table, onRow) => {
    let lastId = 0;
    let scanned = 0;
    for (;;) {
        const [rows] = await db.query(
            `SELECT id, ${columns} FROM ${table} WHERE id > ? ORDER BY id ASC LIMIT ?`,
            [lastId, SWEEP_BATCH_SIZE]
        );
        if (rows.length === 0) break;
        scanned += rows.length;
        for (const row of rows) onRow(row);
        lastId = Number(rows[rows.length - 1].id);
        if (rows.length < SWEEP_BATCH_SIZE) break;
        await yieldToEventLoop();
    }
    return scanned;
};

const sweepExistingReviews = async (db, { dryRun = false } = {}) => {
    const toQueueIds = [];
    let alreadyQueued = 0;

    const scanned = await forEachRowBatch(
        db,
        'comment, user_name, courses, is_approved',
        'reviews',
        (row) => {
            const fields = [row.comment, row.user_name, ...parseCourseList(row.courses)];
            const flagged = fields.some((value) => detectFlaggedText(String(value)).flagged);
            if (!flagged) return;
            if (Number(row.is_approved) === 0) {
                alreadyQueued += 1;
                return;
            }
            toQueueIds.push(row.id);
        }
    );

    if (!dryRun && toQueueIds.length > 0) {
        const CHUNK = 500;
        for (let i = 0; i < toQueueIds.length; i += CHUNK) {
            const chunk = toQueueIds.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => '?').join(',');
            await db.query(
                `UPDATE reviews SET is_approved = 0 WHERE id IN (${placeholders})`,
                chunk
            );
        }
    }

    return {
        scanned,
        toQueue: toQueueIds.length,
        alreadyQueued,
        flaggedIds: toQueueIds,
        dryRun
    };
};

/**
 * Retroactive sweep for questions, answers and custom course suggestions.
 * Tightens only: flagged approved rows become pending (0), flagged
 * approved courses drop back to 'pending'. Rejected/pending rows are
 * never loosened and nothing is auto-approved.
 *
 * @param {{query: Function}} db mysql2 promise pool (or a compatible mock)
 * @param {{dryRun?: boolean}} options preview without updating anything
 */
const sweepExistingQa = async (db, { dryRun = false } = {}) => {
    const partition = async (table, field, isApprovedColumn = 'is_approved') => {
        const toQueue = [];
        let alreadyQueued = 0;
        const scanned = await forEachRowBatch(db, `${field}, ${isApprovedColumn}`, table, (row) => {
            if (!detectFlaggedText(String(row[field] || '')).flagged) return;
            if (Number(row[isApprovedColumn]) === 0) alreadyQueued += 1;
            else toQueue.push(row.id);
        });
        return { scanned, toQueue, alreadyQueued };
    };

    const q = await partition('questions', 'question');
    const a = await partition('question_answers', 'answer');

    const coursesToDemote = [];
    let coursesAlreadyPending = 0;
    const coursesScanned = await forEachRowBatch(db, 'name, status', 'custom_courses', (row) => {
        if (!detectFlaggedText(String(row.name || '')).flagged) return;
        if (row.status === 'approved') coursesToDemote.push(row.id);
        else if (row.status === 'pending') coursesAlreadyPending += 1;
        // rejected stays rejected
    });

    const updateByIds = async (sql, ids) => {
        const CHUNK = 500;
        for (let i = 0; i < ids.length; i += CHUNK) {
            const chunk = ids.slice(i, i + CHUNK);
            const placeholders = chunk.map(() => '?').join(',');
            await db.query(sql.replace('?', placeholders), chunk);
        }
    };

    if (!dryRun) {
        if (q.toQueue.length > 0) await updateByIds('UPDATE questions SET is_approved = 0 WHERE id IN (?)', q.toQueue);
        if (a.toQueue.length > 0) await updateByIds('UPDATE question_answers SET is_approved = 0 WHERE id IN (?)', a.toQueue);
        if (coursesToDemote.length > 0) await updateByIds("UPDATE custom_courses SET status = 'pending' WHERE id IN (?)", coursesToDemote);
    }

    return {
        questions: { scanned: q.scanned, toQueue: q.toQueue.length, alreadyQueued: q.alreadyQueued, flaggedIds: q.toQueue },
        answers: { scanned: a.scanned, toQueue: a.toQueue.length, alreadyQueued: a.alreadyQueued, flaggedIds: a.toQueue },
        courses: { scanned: coursesScanned, toDemote: coursesToDemote.length, alreadyPending: coursesAlreadyPending, flaggedIds: coursesToDemote },
        dryRun
    };
};

module.exports = {
    detectFlaggedText,
    detectSensitiveAllegation,
    moderationFlagFor,
    sweepExistingReviews,
    sweepExistingQa,
    parseCourseList
};
