// Chat assistant knowledge: which teachers a question is about, and what
// review text goes to the model. Pure functions - no DB.
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildKnowledge, matchTeachers, matchTopics, selectContext, detectReplyLanguage, detectAspects, snippetOf } = require('../lib/chatKnowledge');

// Enough "Muhammad"s and "Ali"s that those name parts are common, like in
// the real data, plus a few distinctive names.
const teacherRows = [
    { id: 1, name: 'Waqar Ashiq', department: 'School of Systems and Technology' },
    { id: 2, name: 'Sania Qamar', department: 'School of Law' },
    { id: 3, name: 'Malik Waqar Aslam', department: 'School of Business' },
    { id: 4, name: 'Muhammad Waqas', department: 'School of Science' },
    { id: 5, name: 'Dr Umar Bacha', department: 'School of Science' },
    { id: 6, name: 'Muhamamd Mateen', department: 'School of Science' },
    { id: 7, name: 'Hareem Aslam', department: 'School of Liberal Arts' },
    { id: 8, name: 'Ayesha Noor', department: 'School of Science' },
];
for (let i = 0; i < 120; i++) {
    teacherRows.push({ id: 100 + i, name: `Muhammad ${['Ali', 'Usman', 'Bilal', 'Hamza'][i % 4]} Tx${i}q`, department: 'School of Science' });
}
const reviewRows = [
    { teacher_id: 1, comment: 'Explains calculus really well, grading is fair.', courses: JSON.stringify(['Calculus and Analytic Geometry']), created_at: new Date('2026-03-02') },
    { teacher_id: 1, comment: 'Quizzes every week but he helps in office hours.', courses: JSON.stringify(['Object Oriented Programming']), created_at: new Date('2026-04-02') },
    { teacher_id: 2, comment: 'Attendance is strict, lectures are well organised.', courses: null, created_at: new Date('2026-05-01') },
    { teacher_id: 3, comment: 'Okay teacher.', courses: null, created_at: new Date('2026-05-02') },
    { teacher_id: 7, comment: 'Very kind, assignments are easy.', courses: JSON.stringify(['Digital Logic Design']), created_at: new Date('2026-05-03') },
    { teacher_id: 101, comment: 'Average.', courses: JSON.stringify(['Programming Fundamentals']), created_at: new Date('2026-05-04') },
];
const qaRows = [{ question_id: 50, teacher_id: 1, question: 'Does he curve the final?', answer: 'Yes, a small curve.' }];
const kn = buildKnowledge(teacherRows, reviewRows, qaRows);
const names = (text) => matchTeachers(kn, text).matches.map((m) => m.teacher.name);

describe('chat: matching teachers by name', () => {
    it('finds a teacher by first name with an honorific (Roman Urdu)', () => {
        assert.equal(names('sir waqar ashiq ki grading kesi hai?')[0], 'Waqar Ashiq');
        assert.deepEqual(names("ma'am sania attendance strict hai?"), ['Sania Qamar']);
    });

    it('tolerates a small typo in a distinctive name', () => {
        assert.deepEqual(names('sania qamr kesi hain'), ['Sania Qamar']);
    });

    it('prefers the exact name over a one-letter-off name', () => {
        assert.deepEqual(names('waqas sir kaise hain'), ['Muhammad Waqas']);
    });

    it('does not typo-match a common name to a rare misspelling', () => {
        const res = matchTeachers(kn, 'muhammad sb kaise parhate hain');
        assert.ok(!res.matches.some((m) => m.teacher.name === 'Muhamamd Mateen'));
        assert.equal(res.ambiguous, true);
    });

    it('ignores Roman Urdu words that look like names ("acha" is not "Bacha")', () => {
        assert.deepEqual(names('programming fundamentals ke liye kon acha hai'), []);
    });

    it('returns both teachers in a comparison question', () => {
        assert.deepEqual(names('waqar ashiq ya sania qamar kon better hai').sort(), ['Sania Qamar', 'Waqar Ashiq']);
    });

    it('treats a first name shared by several teachers as a reference to all of them, most-reviewed first', () => {
        const res = matchTeachers(kn, 'sir waqar kaise hain');
        assert.deepEqual(res.matches.map((m) => m.teacher.name), ['Waqar Ashiq', 'Malik Waqar Aslam']);
    });

    it('marks a lone common name as ambiguous', () => {
        assert.equal(matchTeachers(kn, 'sir ali kaise hain').ambiguous, true);
    });

    it('finds nothing in a general question', () => {
        assert.deepEqual(names('which teachers are lenient in grading?'), []);
        assert.deepEqual(names('How do I write a review?'), []);
    });
});

describe('chat: matching courses', () => {
    const courses = (text) => matchTopics(kn, text).courses.map((c) => c.name);
    it('matches a single significant course word', () => {
        assert.deepEqual(courses('best teacher for calculus?'), ['Calculus and Analytic Geometry']);
    });
    it('matches short forms', () => {
        assert.deepEqual(courses('oop kis se parhun'), ['Object Oriented Programming']);
        assert.deepEqual(courses('dld ke liye best teacher'), ['Digital Logic Design']);
        assert.deepEqual(courses('PF kis se parhun'), ['Programming Fundamentals']);
    });
    it('does not read ordinary two-letter words as short forms', () => {
        assert.deepEqual(courses('how is it going'), []);
    });
});

describe('chat: context for the model', () => {
    it('a question about one teacher includes all their reviews and Q&A, and nobody else', () => {
        const sel = selectContext(kn, { message: 'how is sir waqar ashiq?' });
        assert.deepEqual(sel.focusedTeachers.map((t) => t.id), [1]);
        assert.match(sel.context, /Explains calculus really well/);
        assert.match(sel.context, /Quizzes every week/);
        assert.match(sel.context, /Does he curve the final\?/);
        assert.doesNotMatch(sel.context, /Attendance is strict/);
    });

    it('never includes reviewer names', () => {
        const sel = selectContext(kn, { message: 'tell me about all teachers' });
        assert.doesNotMatch(sel.context, /Anonymous|user_name/);
    });

    it('a follow-up without a name continues with the teacher from earlier', () => {
        const sel = selectContext(kn, {
            message: 'aur unki attendance?',
            history: [{ role: 'user', text: 'sania qamar kaisi hain?' }, { role: 'assistant', text: 'Students say...' }]
        });
        assert.equal(sel.focusSource, 'history');
        assert.deepEqual(sel.focusedTeachers.map((t) => t.id), [2]);
    });

    it('on a teacher page, "inki grading?" is about that teacher', () => {
        const sel = selectContext(kn, { message: 'inki grading kesi hai?', pageTeacherId: 7 });
        assert.equal(sel.focusSource, 'page');
        assert.deepEqual(sel.focusedTeachers.map((t) => t.id), [7]);
    });

    it('a named teacher wins over the page teacher', () => {
        const sel = selectContext(kn, { message: 'sania qamar kaisi hain?', pageTeacherId: 7 });
        assert.deepEqual(sel.focusedTeachers.map((t) => t.id), [2]);
    });

    it('a general question gets every reviewed teacher, course matches first', () => {
        const sel = selectContext(kn, { message: 'best teacher for calculus?' });
        assert.equal(sel.focusedTeachers.length, 0);
        const reviewed = kn.teachers.filter((t) => t.reviews.length > 0).map((t) => t.id);
        assert.deepEqual([...sel.includedTeacherIds].sort(), reviewed.sort());
        assert.ok(sel.context.indexOf('Waqar Ashiq') < sel.context.indexOf('Sania Qamar'));
    });

    it('respects the size budget and says what was left out', () => {
        const sel = selectContext(kn, { message: 'who is the best teacher?', maxChars: 400 });
        assert.ok(sel.context.length < 900);
        assert.match(sel.context, /more reviewed teachers were left out/);
    });

    it('says when a matched teacher has no reviews yet', () => {
        const sel = selectContext(kn, { message: 'ayesha noor kaisi hain' });
        assert.match(sel.context, /no approved reviews yet/);
    });
});

describe('detectReplyLanguage', () => {
    it('spots Roman Urdu questions', () => {
        for (const q of ['sir waqar ashiq ki grading kesi hai?', 'aur attendance?', 'review kaise likhun', 'Calculus ke liye best teacher kaun hai?', 'grading kesi krte hn']) {
            assert.equal(detectReplyLanguage(q), 'roman-urdu', q);
        }
    });

    it('keeps English questions in English', () => {
        for (const q of ['is he strict?', 'How is Sania Qamar as a teacher?', 'Which teachers are lenient in grading?', 'is sir ali good for beginners', 'What do students say about her?', 'mere details are enough']) {
            assert.equal(detectReplyLanguage(q), 'english', q);
        }
    });

    it('recognises Urdu script', () => {
        assert.equal(detectReplyLanguage('سر وقار کیسے پڑھاتے ہیں؟'), 'urdu');
    });
});

describe('chat: smaller context for general questions', () => {
    it('reads the topic of a question in English and Roman Urdu', () => {
        assert.deepEqual(detectAspects('Which teacher grades leniently?'), ['grading']);
        assert.deepEqual(detectAspects('marks kese deti hain'), ['grading']);
        assert.deepEqual(detectAspects('kon acha parhata hai'), ['teaching']);
        assert.deepEqual(detectAspects('quiz aur assignments kis ke easy hain?'), ['exams', 'assignments']);
        assert.deepEqual(detectAspects('best teacher kaun hai?'), [], '"teacher" is not "teaching"');
    });

    it('cuts a review down to the part about the topic', () => {
        const long = `${'Very kind person and always on time for class. '.repeat(6)}Her grading is relative and quite lenient in the final. ${'She shares slides after class. '.repeat(5)}`;
        const snip = snippetOf(long, ['grading']);
        assert.ok(snip.length <= 230, snip);
        assert.match(snip, /grading is relative/);
        assert.equal(snippetOf('Attendance is strict.', ['grading']), null);
        assert.equal(snippetOf('Short review.', []), 'Short review.');
    });

    it('stays within the general budget however large the corpus is', () => {
        const teachers = [];
        const reviews = [];
        for (let i = 1; i <= 300; i += 1) {
            teachers.push({ id: 1000 + i, name: `Teacher Number${i}`, department: 'School of Testing' });
            for (let j = 0; j < 4; j += 1) {
                reviews.push({ teacher_id: 1000 + i, comment: `Review ${j}: grading is fair and lectures are clear. `.repeat(8), courses: '[]', created_at: '2026-01-01' });
            }
        }
        const big = buildKnowledge(teachers, reviews, []);
        const sel = selectContext(big, { message: 'who grades fairly?', generalChars: 8000 });
        assert.equal(sel.mode, 'general');
        assert.ok(sel.context.length <= 8600, String(sel.context.length));
        assert.match(sel.context, /left out for length/);
    });

    it('a teacher question still gets every review in full', () => {
        const sel = selectContext(kn, { message: 'how is sir waqar ashiq?', generalChars: 3000 });
        assert.equal(sel.mode, 'focused');
        assert.match(sel.context, /Explains calculus really well/);
        assert.match(sel.context, /Quizzes every week/);
    });
});
