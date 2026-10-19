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
const { detectFlaggedText } = require('./contentFilter');

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
