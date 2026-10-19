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

module.exports = { detectFlaggedText };
