// Knowledge for the chat assistant: every approved review and answered Q&A,
// grouped by teacher, plus the matching that turns a free-form question
// ("sir waqar ki grading kesi hai?") into the teachers it is about.
//
// Only public data is used (approved reviews, approved questions/answers).
// Reviewer names are never included.

const { parseCourseList } = require('../contentFilter');

const KNOWLEDGE_TTL_MS = 5 * 60 * 1000;
// Upper bound for the review text sent with one question. ~4 chars per token
// for English, fewer for Roman Urdu, so this stays well under the free-tier
// tokens-per-minute budget while today's whole corpus still fits.
const DEFAULT_CONTEXT_CHARS = 90000;
// General questions ("best teacher?", "who grades leniently?") used to get
// every review up to DEFAULT_CONTEXT_CHARS - about 20k tokens per question on
// the free tier. They now get one summary line per teacher plus short
// excerpts on the topic asked about, within this smaller budget.
const DEFAULT_GENERAL_CONTEXT_CHARS = 16000;
const SNIPPET_CHARS = 220;
const MAX_FOCUSED_TEACHERS = 4;
const MAX_REVIEW_CHARS = 1200;

// Words people put around a teacher's name; never part of a match.
const HONORIFICS = new Set([
    'sir', 'mr', 'mrs', 'ms', 'miss', 'maam', 'mam', 'madam', 'madame', 'dr', 'doctor',
    'prof', 'professor', 'teacher', 'ustad', 'ustaad', 'sahab', 'sahib', 'saab', 'ji', 'janab'
]);

// Common words that also occur inside teacher names or departments and would
// otherwise produce matches ("ali" in "khaali"? no - but "is", "of", "and").
const STOPWORDS = new Set([
    'the', 'and', 'of', 'for', 'is', 'are', 'how', 'what', 'who', 'which', 'about', 'with', 'his', 'her',
    'school', 'institute', 'department', 'faculty', 'college', 'center', 'centre',
    'hai', 'hain', 'hn', 'ha', 'ka', 'ki', 'ke', 'ko', 'se', 'me', 'mein', 'aur', 'kya', 'kaise', 'kesi',
    'kaisi', 'kaisa', 'kesa', 'kon', 'kaun', 'wo', 'woh', 'unki', 'unka', 'inki', 'ye', 'yeh',
    'acha', 'achha', 'achi', 'achhi', 'acchi', 'bura', 'buri', 'sahi', 'best', 'good', 'bad', 'better', 'worst',
    'parhate', 'parhati', 'parhata', 'parhana', 'parhte', 'padhate', 'padhati', 'teach', 'teaches', 'teaching',
    'grading', 'grade', 'grades', 'marks', 'marking', 'attendance', 'quiz', 'quizzes', 'exam', 'exams',
    'strict', 'lenient', 'easy', 'hard', 'tough', 'class', 'course', 'courses', 'review', 'reviews',
    'liye', 'lie', 'wala', 'wali', 'wale', 'kis', 'kisi', 'sab', 'bhi', 'nahi', 'nahin', 'hota', 'hoti', 'karte',
    'karti', 'krte', 'krti', 'dete', 'deti', 'tell', 'know', 'like', 'does', 'should', 'take', 'which',
    'teachers', 'student', 'students', 'professors', 'faculty', 'university', 'umt'
]);

const normalize = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();

const tokenize = (s) => normalize(s).split(' ').filter(Boolean);

// Damerau-free Levenshtein, early exit above `max`.
const editDistance = (a, b, max = 2) => {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i];
        let rowMin = i;
        for (let j = 1; j <= b.length; j++) {
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
            rowMin = Math.min(rowMin, cur[j]);
        }
        if (rowMin > max) return max + 1;
        prev = cur;
    }
    return prev[b.length];
};

// Does query token `q` refer to name token `n`? Exact, or a small typo for
// longer names ("waqas" vs "waqar" is NOT allowed: different first letters
// are fine, but only one edit for 5-7 letters, two for 8+).
const tokenMatches = (q, n) => {
    if (q === n) return true;
    if (n.length < 5 || q.length < 4 || q[0] !== n[0]) return false;
    const allowed = n.length >= 8 ? 2 : 1;
    return editDistance(q, n, allowed) <= allowed;
};

let cached = null;
let cachedAt = 0;
let loading = null;

const buildKnowledge = (teacherRows, reviewRows, qaRows) => {
    const byId = new Map();
    for (const t of teacherRows) {
        byId.set(t.id, {
            id: t.id,
            name: String(t.name || '').trim(),
            department: String(t.department || '').trim(),
            nameTokens: tokenize(t.name).filter((w) => w.length >= 3 && !HONORIFICS.has(w)),
            reviews: [],
            qa: [],
            courses: new Set()
        });
    }
    for (const r of reviewRows) {
        const t = byId.get(r.teacher_id);
        if (!t) continue;
        const courses = parseCourseList(r.courses);
        courses.forEach((c) => t.courses.add(c));
        t.reviews.push({
            text: String(r.comment || '').replace(/\s+/g, ' ').trim().slice(0, MAX_REVIEW_CHARS),
            courses,
            date: r.created_at ? new Date(r.created_at).toISOString().slice(0, 7) : ''
        });
    }
    for (const row of qaRows) {
        const t = byId.get(row.teacher_id);
        if (!t) continue;
        let entry = t.qa.find((e) => e.id === row.question_id);
        if (!entry) {
            entry = { id: row.question_id, question: String(row.question || '').trim(), answers: [] };
            t.qa.push(entry);
        }
        entry.answers.push(String(row.answer || '').replace(/\s+/g, ' ').trim().slice(0, 600));
    }

    const teachers = [...byId.values()];
    // Inverse document frequency of each name token: "muhammad" is in a
    // hundred names and says little; "waqar" is in two and says a lot.
    const df = new Map();
    for (const t of teachers) {
        for (const w of new Set(t.nameTokens)) df.set(w, (df.get(w) || 0) + 1);
    }
    const idf = (w) => Math.log(1 + teachers.length / (df.get(w) || 1));
    const nameVocab = new Set(df.keys());
    // A name token shared by only a few teachers identifies them on its own
    // ("waqar"); a common one ("muhammad", "ali") does not.
    const distinctiveDf = Math.max(5, Math.ceil(teachers.length * 0.01));
    const isDistinctive = (w) => (df.get(w) || 0) <= distinctiveDf;

    // Course and department vocabularies for topic questions.
    const courseIndex = new Map(); // normalized course -> { name, teacherIds:Set }
    const deptIndex = new Map();
    for (const t of teachers) {
        for (const c of t.courses) {
            const key = normalize(c);
            if (!key) continue;
            if (!courseIndex.has(key)) courseIndex.set(key, { name: c, teacherIds: new Set() });
            courseIndex.get(key).teacherIds.add(t.id);
        }
        const dk = normalize(t.department);
        if (dk) {
            if (!deptIndex.has(dk)) deptIndex.set(dk, { name: t.department, teacherIds: new Set() });
            deptIndex.get(dk).teacherIds.add(t.id);
        }
    }

    return {
        teachers,
        byId,
        idf,
        isDistinctive,
        nameVocab,
        courseIndex,
        deptIndex,
        totalReviews: reviewRows.length,
        // Changes whenever an approved review or answer is added or removed;
        // part of the chat answer cache key so new reviews are never hidden.
        version: [
            reviewRows.length,
            reviewRows.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0),
            qaRows.length,
            qaRows.reduce((m, r) => Math.max(m, Number(r.answer_id) || 0), 0)
        ].join('.'),
        reviewedTeachers: teachers.filter((t) => t.reviews.length > 0).length
    };
};

const loadKnowledge = async ({ force = false } = {}) => {
    if (!force && cached && Date.now() - cachedAt < KNOWLEDGE_TTL_MS) return cached;
    if (loading) return loading;
    loading = (async () => {
        try {
            // Required lazily so the pure matching code can be unit-tested without a DB.
            const db = require('../db');
            const [teacherRows] = await db.query('SELECT id, name, department FROM teachers');
            const [reviewRows] = await db.query(
                `SELECT id, teacher_id, comment, courses, created_at
                 FROM reviews WHERE is_approved = 1
                 ORDER BY created_at DESC, id DESC`
            );
            const [qaRows] = await db.query(
                `SELECT q.id AS question_id, q.teacher_id, q.question, a.id AS answer_id, a.answer
                 FROM questions q
                 JOIN question_answers a ON a.question_id = q.id AND a.is_approved = 1
                 WHERE q.is_approved = 1
                 ORDER BY q.created_at DESC, a.created_at ASC`
            );
            cached = buildKnowledge(teacherRows, reviewRows, qaRows);
            cachedAt = Date.now();
            return cached;
        } finally {
            loading = null;
        }
    })();
    return loading;
};

const invalidateKnowledge = () => { cached = null; cachedAt = 0; };

/**
 * Teachers a piece of text refers to by name.
 * Returns { matches: [{ teacher, score }], ambiguous } best first.
 * `ambiguous` means only a common name was given ("sir ali"): the matches
 * are candidates for the model to ask about, not a confident answer.
 */
const matchTeachers = (knowledge, text) => {
    const none = { matches: [], ambiguous: false };
    const queryTokens = tokenize(text).filter((w) => w.length >= 3 && !HONORIFICS.has(w) && !STOPWORDS.has(w));
    if (queryTokens.length === 0) return none;
    const normText = ` ${normalize(text)} `;
    const scored = [];
    for (const t of knowledge.teachers) {
        if (t.nameTokens.length === 0) continue;
        let score = 0;
        let matched = 0;
        let distinctive = false;
        for (const n of t.nameTokens) {
            const exact = queryTokens.includes(n);
            // Typo tolerance only for words that are not themselves a known
            // name part: "muhammad" must not match the one "Muhamamd".
            if (!exact && !queryTokens.some((q) => !knowledge.nameVocab.has(q) && tokenMatches(q, n))) continue;
            // A typo match counts less than the exact name.
            score += knowledge.idf(n) * (exact ? 1 : 0.6);
            matched++;
            if (knowledge.isDistinctive(n)) distinctive = true;
        }
        if (matched === 0) continue;
        const fullName = normText.includes(` ${t.nameTokens.join(' ')} `);
        // The full name written out is the strongest signal.
        if (fullName) score += 3;
        scored.push({ teacher: t, score, confident: distinctive || matched >= 2 || fullName });
    }
    if (scored.length === 0) return none;
    const byScore = (a, b) => b.score - a.score || b.teacher.reviews.length - a.teacher.reviews.length;
    const confident = scored.filter((s) => s.confident).sort(byScore);
    if (confident.length) {
        const best = confident[0].score;
        const matches = confident.filter((s) => s.score >= best * 0.75);
        return { matches, ambiguous: matches.length > MAX_FOCUSED_TEACHERS };
    }
    // Only common name parts matched: offer the best-reviewed candidates.
    scored.sort((a, b) => b.teacher.reviews.length - a.teacher.reviews.length || b.score - a.score);
    return { matches: scored.slice(0, 8), ambiguous: true };
};

const COURSE_FILLER = new Set(['and', 'of', 'the', 'for', 'to', 'in', 'with', 'i', 'ii', 'iii', 'iv', '1', '2', '3', 'lab', 'introduction', 'intro', 'basic', 'basics', 'applied', 'advanced', 'principles', 'fundamentals', 'theory', 'management', 'studies', 'system', 'systems']);
const acronymOf = (key) => key.split(' ').filter((w) => !COURSE_FILLER.has(w) || w === 'fundamentals' || w === 'systems' || w === 'system' || w === 'management')
    .filter((w) => !['and', 'of', 'the', 'for', 'to', 'in', 'with'].includes(w) && !/^(i|ii|iii|iv|\d+)$/.test(w))
    .map((w) => w[0]).join('');

/** Courses / departments mentioned in the text -> teacher ids. */
const matchTopics = (knowledge, text) => {
    const norm = ` ${normalize(text)} `;
    const rawTokens = tokenize(text);
    const queryTokens = new Set(rawTokens.filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !COURSE_FILLER.has(w)));
    // Short forms: 3+ letters in any case ("oop", "dld"); 2-letter ones only
    // when typed in capitals ("PF", "DS"), since "is"/"it" are words.
    const shortTokens = new Set(rawTokens.filter((w) => w.length >= 3 && w.length <= 5));
    (String(text).match(/\b[A-Z]{2}\b/g) || []).forEach((w) => shortTokens.add(w.toLowerCase()));
    const courses = [];
    for (const [key, entry] of knowledge.courseIndex) {
        const words = key.split(' ');
        const significant = words.filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !COURSE_FILLER.has(w));
        const acronym = acronymOf(key);
        if (norm.includes(` ${key} `)
            || significant.some((w) => queryTokens.has(w))
            || (acronym.length >= 2 && shortTokens.has(acronym))) courses.push(entry);
    }
    const departments = [];
    for (const [key, entry] of knowledge.deptIndex) {
        const words = key.split(' ').filter((w) => w.length >= 4 && !STOPWORDS.has(w));
        if (words.length === 0) continue;
        if (norm.includes(` ${key} `) || words.every((w) => queryTokens.has(w))) departments.push(entry);
    }
    return { courses, departments };
};

const formatTeacher = (t, { maxReviews = Infinity } = {}) => {
    const lines = [];
    const courseList = [...t.courses].slice(0, 12);
    lines.push(`### ${t.name} (teacher id ${t.id}) | ${t.department || 'department unknown'} | ${t.reviews.length} approved review${t.reviews.length === 1 ? '' : 's'}${courseList.length ? ` | courses mentioned: ${courseList.join(', ')}` : ''}`);
    if (t.reviews.length === 0) lines.push('(no approved reviews yet)');
    t.reviews.slice(0, maxReviews).forEach((r, i) => {
        const meta = [r.date, r.courses.length ? `course: ${r.courses.join(', ')}` : ''].filter(Boolean).join(', ');
        lines.push(`- Review ${i + 1}${meta ? ` [${meta}]` : ''}: "${r.text.replace(/"/g, "'")}"`);
    });
    if (t.qa.length > 0) {
        lines.push('Q&A from students:');
        t.qa.slice(0, 8).forEach((q) => {
            lines.push(`- Q: "${q.question.replace(/"/g, "'")}" A: ${q.answers.map((a) => `"${a.replace(/"/g, "'")}"`).join(' / ')}`);
        });
    }
    return lines.join('\n');
};

// What a question is about, so a general question only carries the parts of
// reviews that answer it. Stems match the start of a word, which covers
// English and Roman Urdu spellings ("parhata", "parhati", "parhane").
const ASPECTS = {
    grading: ['grad', 'marks', 'marking', 'number', 'nambar', 'gpa', 'cgpa', 'lenient', 'generous', 'curve', 'relative', 'absolute', 'a+'],
    attendance: ['attend', 'atend', 'absent', 'haziri', 'hazri', 'proxy', 'late'],
    teaching: ['teaching', 'teaches', 'taught', 'parha', 'parhe', 'parhi', 'parh', 'prha', 'prhe', 'prhi', 'explain', 'concept', 'lecture', 'samjh', 'samajh', 'smjh', 'delivery', 'method', 'slides'],
    exams: ['exam', 'paper', 'mid', 'final', 'test', 'quiz', 'checking', 'check'],
    assignments: ['assign', 'project', 'presentation', 'lab', 'workload', 'task', 'quiz', 'deadline'],
    behaviour: ['behav', 'attitude', 'rude', 'polite', 'friendly', 'nice', 'strict', 'cooperat', 'support', 'helpful', 'akhlaq', 'ghuss', 'guss', 'mood', 'respect', 'humble', 'arrogant', 'insult', 'easygoing', 'chill'],
};
const stemRegex = (stems) => new RegExp(`(?:^|[^a-z0-9])(${stems.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'i');
const ASPECT_REGEX = Object.fromEntries(Object.entries(ASPECTS).map(([k, stems]) => [k, stemRegex(stems)]));

const detectAspects = (text) => Object.keys(ASPECT_REGEX).filter((k) => ASPECT_REGEX[k].test(String(text || '')));

// "How do I write a review?" needs the site facts, not 400 reviews.
const SITE_HELP_REGEX = /\b(website|site|app|install|account|log ?in|sign ?up|password|contact|email|privacy|terms|dmca|delete|remove|report|repl(?:y|ies)|compare|search|sort|filter|anonymous|post|submit|moderat\w*|write|likh\w*|add|suggest)\b/i;
const RECOMMEND_REGEX = /\b(best|acha|achi|achay|ache|achey|worst|recommend\w*|top|kon|kaun|konsa|konsi|kis|which|who|easy|asan|aasan|tough|mushkil|lenient|strict)\b/i;
const isSiteHelpQuestion = (text, aspects) => aspects.length === 0
    && SITE_HELP_REGEX.test(text)
    && !RECOMMEND_REGEX.test(text);

// A ~SNIPPET_CHARS window of the review around the first aspect word, cut at
// word boundaries. Without aspects, the start of the review.
const snippetOf = (text, aspects) => {
    const clean = String(text || '');
    let at = 0;
    if (aspects.length) {
        let best = -1;
        for (const a of aspects) {
            const m = ASPECT_REGEX[a].exec(clean);
            if (m && (best === -1 || m.index < best)) best = m.index;
        }
        if (best === -1) return null;
        at = Math.max(0, best - Math.floor(SNIPPET_CHARS * 0.35));
    }
    if (clean.length <= SNIPPET_CHARS && at === 0) return clean;
    let start = at;
    if (start > 0) {
        const space = clean.indexOf(' ', start);
        start = space === -1 || space - start > 20 ? start : space + 1;
    }
    let end = Math.min(clean.length, start + SNIPPET_CHARS);
    if (end < clean.length) {
        const space = clean.lastIndexOf(' ', end);
        if (space > start + SNIPPET_CHARS * 0.6) end = space;
    }
    return `${start > 0 ? '…' : ''}${clean.slice(start, end).trim()}${end < clean.length ? '…' : ''}`;
};

// One line per teacher plus a few excerpts: enough to compare and recommend.
const formatTeacherCompact = (t, { aspects = [], maxSnippets = 2 } = {}) => {
    const courseList = [...t.courses].slice(0, 6);
    const lines = [`### ${t.name} (teacher id ${t.id}) | ${t.department || 'department unknown'} | ${t.reviews.length} review${t.reviews.length === 1 ? '' : 's'}${courseList.length ? ` | courses: ${courseList.join(', ')}` : ''}`];
    let shown = 0;
    for (const r of t.reviews) {
        if (shown >= maxSnippets) break;
        const snip = snippetOf(r.text, aspects);
        if (!snip) continue;
        lines.push(`- "${snip.replace(/"/g, "'")}"`);
        shown += 1;
    }
    return { text: lines.join('\n'), snippets: shown };
};

/**
 * Pick what the model gets to read for this conversation.
 *
 * - Teachers named in the latest message (or, for follow-ups such as
 *   "aur unki attendance?", in earlier user messages / the page the user is
 *   on) get all their reviews and Q&A.
 * - With no specific teacher, the question is general ("best teacher for
 *   calculus?"): teachers matching a course/department come first, then every
 *   other reviewed teacher until the size budget is used.
 */
const selectContext = (knowledge, { message, history = [], pageTeacherId = null, maxChars = DEFAULT_CONTEXT_CHARS, generalChars = DEFAULT_GENERAL_CONTEXT_CHARS }) => {
    let { matches, ambiguous } = matchTeachers(knowledge, message);
    let focusSource = matches.length ? 'message' : null;

    // "inki grading?" on a teacher page: the page is the subject unless the
    // message confidently names someone else.
    if ((!matches.length || ambiguous) && pageTeacherId && knowledge.byId.has(pageTeacherId)) {
        matches = [{ teacher: knowledge.byId.get(pageTeacherId), score: 99 }];
        ambiguous = false;
        focusSource = 'page';
    }
    if (!matches.length) {
        const earlier = history.filter((h) => h.role === 'user').map((h) => h.text).reverse();
        for (const text of earlier) {
            const m = matchTeachers(knowledge, text);
            if (m.matches.length) { ({ matches, ambiguous } = m); focusSource = 'history'; break; }
        }
    }
    const focused = matches.slice(0, ambiguous ? 8 : MAX_FOCUSED_TEACHERS).map((m) => m.teacher);

    const parts = [];
    let used = 0;
    const push = (text) => { parts.push(text); used += text.length + 2; };
    const included = new Set();

    if (focused.length) {
        push(ambiguous
            ? '## Several teachers match the name in the question (most-reviewed first)'
            : '## Teachers the user is asking about');
        for (const t of focused) {
            push(formatTeacher(t, { maxReviews: ambiguous ? 6 : Infinity }));
            included.add(t.id);
        }
    }

    const topics = matchTopics(knowledge, message);
    const topicIds = new Set();
    topics.courses.forEach((c) => c.teacherIds.forEach((id) => topicIds.add(id)));
    topics.departments.forEach((d) => d.teacherIds.forEach((id) => topicIds.add(id)));

    // Aspects come from the latest message, or from the earlier question when
    // the follow-up is short ("aur attendance?" already names one).
    const aspects = detectAspects(message);
    let mode = focused.length && !ambiguous ? 'focused' : 'general';
    const siteHelp = !focused.length && !topicIds.size && isSiteHelpQuestion(message, aspects);
    if (siteHelp) mode = 'site';

    // A specific-teacher question does not need the rest of the corpus, and a
    // question about the website needs none of it. A general one gets a compact
    // digest: topic matches first (with more excerpts), then the most-reviewed.
    if (mode === 'general') {
        const budget = Math.min(maxChars, Math.max(used + 500, used + generalChars));
        const rank = (t) => (topicIds.has(t.id) ? 1e6 : 0) + t.reviews.length;
        const rest = knowledge.teachers
            .filter((t) => !included.has(t.id) && t.reviews.length > 0)
            .sort((a, b) => rank(b) - rank(a));
        const topicLabel = [...topics.courses.map((c) => c.name), ...topics.departments.map((d) => d.name)].slice(0, 5).join(', ');
        push([
            '## Digest of reviewed teachers',
            `Each teacher has one summary line and a few short excerpts${aspects.length ? ` about ${aspects.join(', ')}` : ''}, not every review.${topicLabel ? ` Teachers matching ${topicLabel} come first.` : ' Most-reviewed teachers come first.'}`,
        ].join('\n'));
        let omitted = 0;
        let silent = 0;
        for (const t of rest) {
            const onTopic = topicIds.has(t.id);
            const { text, snippets } = formatTeacherCompact(t, { aspects, maxSnippets: onTopic ? 5 : (aspects.length ? 3 : 2) });
            // On an aspect question, a teacher whose reviews never mention it
            // adds nothing (unless they match the course/department asked about).
            if (aspects.length && snippets === 0 && !onTopic) { silent++; continue; }
            if (used + text.length > budget) { omitted++; continue; }
            push(text);
            included.add(t.id);
        }
        if (silent) push(`(${silent} other reviewed teachers have no review that mentions ${aspects.join(' or ')}.)`);
        if (omitted) push(`(${omitted} more reviewed teachers were left out for length; they have fewer reviews.)`);
    } else if (mode === 'site') {
        push('(This is a question about using the website: answer it from the website facts. No review data is needed.)');
    }

    return {
        context: parts.join('\n\n'),
        focusedTeachers: focused,
        focusSource,
        ambiguous,
        includedTeacherIds: included,
        topics,
        aspects,
        mode
    };
};

// Words that only show up when someone writes Urdu in English letters. Kept to
// words that are not also common English words ("main", "he", "to" are left out).
const ROMAN_URDU_MARKERS = new Set(`
hai hain hn hy hen kesi kaisi kaise kese kaisa kesa kesy kya kia kyun kyu kaun kon konsa konsi aur nahi nhi nai
mein ki ka ke ko se sy wala wali waly krte karte krta karta krti karti krty karty krain karein parhate parhaty
parhata parhatay padhate parhati achy acha achi achay achha achhe bata batao btao batayen chahiye chahye chaiye
hoga hogi hoge raha rahi rahe kitna kitni kitne mujhe mjhe mujhy mera meri aap apka apki unka unki unke inka
inki yeh woh lena lun loon likhun likhon kab kahan kidhar theek thik bhi sab koi kuch lekin laikin magar agar toh
tou phir bohat bht boht zyada ziada thora thori dete dety deti lagate lagaty lgaty milta milti jata jati sakta sakti
`.split(/\s+/).filter(Boolean));

/**
 * Which language the reply should be in, judged from the latest message.
 * The reviews are mostly Roman Urdu, so without an explicit instruction the
 * model tends to drift into the language of the data rather than the user's.
 */
/** Share (0..1) of words in `text` that are Roman Urdu marker words. */
const romanUrduShare = (text) => {
    const words = String(text || '').toLowerCase().match(/[a-z]+/g) || [];
    if (words.length === 0) return 0;
    return words.filter((w) => ROMAN_URDU_MARKERS.has(w)).length / words.length;
};

const detectReplyLanguage = (message) => {
    const text = String(message || '');
    if (/[\u0600-\u06FF]/.test(text)) return 'urdu';
    const words = text.toLowerCase().match(/[a-z]+/g) || [];
    return words.some((w) => ROMAN_URDU_MARKERS.has(w)) ? 'roman-urdu' : 'english';
};

// Any letter outside the Latin script (Urdu, Hindi, Gujarati...): Roman Urdu
// text written for the site must not contain them.
const FOREIGN_LETTER = /[^\P{L}\p{Script=Latin}]/u;
const hasForeignLetters = (text) => FOREIGN_LETTER.test(String(text || ''));

/**
 * A summary that is safe to show while it waits to be re-written: list
 * points with another script are dropped, and in the overview only the
 * affected words are removed. No AI call.
 */
const withoutForeignScript = (parsed) => {
    if (!parsed) return parsed;
    const scrub = (text) => String(text || '').split(/\s+/).filter((word) => !hasForeignLetters(word)).join(' ').trim();
    const keep = (list) => (Array.isArray(list) ? list : []).filter((line) => !hasForeignLetters(line));
    return {
        ...parsed,
        overview: hasForeignLetters(parsed.overview) ? scrub(parsed.overview) : parsed.overview,
        pros: keep(parsed.pros),
        cons: keep(parsed.cons)
    };
};

module.exports = {
    hasForeignLetters,
    withoutForeignScript,
    detectReplyLanguage,
    romanUrduShare,
    loadKnowledge,
    invalidateKnowledge,
    buildKnowledge,
    matchTeachers,
    matchTopics,
    selectContext,
    normalize,
    detectAspects,
    snippetOf,
    DEFAULT_CONTEXT_CHARS,
    DEFAULT_GENERAL_CONTEXT_CHARS
};
