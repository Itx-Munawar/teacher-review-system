// Chat assistant API against the real server, with a fake Gemini endpoint
// that records what it was sent and replies as scripted.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SKIP, resetDatabase, dbQuery, startServer, createClient, createAdminAndLogin } = require('../testing/apiHarness');
const { startFakeGemini } = require('../testing/fakeGemini');

const systemText = (call) => call.body.systemInstruction.parts.map((p) => p.text).join('');

describe('chat API', { skip: SKIP }, () => {
    let server;
    let fake;
    let waqar;
    let sania;

    before(async () => {
        await resetDatabase();
        waqar = (await dbQuery("INSERT INTO teachers (name, department) VALUES ('Waqar Ashiq', 'School of Systems and Technology')")).insertId;
        sania = (await dbQuery("INSERT INTO teachers (name, department) VALUES ('Sania Qamar', 'School of Law')")).insertId;
        await dbQuery("INSERT INTO teachers (name, department) VALUES ('Bilal Ahmed', 'School of Business')");
        await dbQuery(
            "INSERT INTO reviews (teacher_id, comment, user_name, courses, is_approved) VALUES (?, 'Grading is fair and he explains calculus clearly.', 'SecretReviewerName', ?, 1)",
            [waqar, JSON.stringify(['Calculus I'])]
        );
        await dbQuery("INSERT INTO reviews (teacher_id, comment, is_approved) VALUES (?, 'PENDING-TEXT should never reach the model.', 0)", [waqar]);
        await dbQuery("INSERT INTO reviews (teacher_id, comment, is_approved) VALUES (?, 'Attendance is strict but lectures are organised.', 1)", [sania]);
        const q = await dbQuery("INSERT INTO questions (teacher_id, question, is_approved) VALUES (?, 'Does he curve the final?', 1)", [waqar]);
        await dbQuery("INSERT INTO question_answers (question_id, answer, is_approved) VALUES (?, 'Yes, a small curve.', 1)", [q.insertId]);

        fake = await startFakeGemini();
        server = await startServer({
            GEMINI_API_KEY: 'test-gemini-key',
            GEMINI_API_BASE: fake.url,
            GEMINI_MODELS: 'model-a,model-b',
            CHAT_PER_MINUTE: '4'
        });
    });

    after(async () => {
        if (server) await server.stop();
        if (fake) await fake.close();
    });

    beforeEach(() => { fake.calls.length = 0; fake.queue.length = 0; });

    it('reports itself enabled when a key is configured', async () => {
        const res = await createClient(server.baseUrl).get('/api/chat/status');
        assert.equal(res.status, 200);
        assert.equal(res.body.enabled, true);
    });

    it('answers a question about a teacher from their approved reviews and Q&A only', async () => {
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'sir waqar ki grading kesi hai?' });
        assert.equal(res.status, 200, res.text);
        assert.match(res.body.reply, /Students say/);
        assert.deepEqual(res.body.teachers, [{ id: waqar, name: 'Waqar Ashiq', department: 'School of Systems and Technology' }]);

        assert.equal(fake.calls.length, 1);
        const call = fake.calls[0];
        assert.equal(call.key, 'test-gemini-key');
        assert.equal(call.model, 'model-a');
        const sys = systemText(call);
        assert.match(sys, /Grading is fair and he explains calculus clearly/);
        assert.match(sys, /Does he curve the final\?/);
        assert.match(sys, /Yes, a small curve/);
        assert.match(sys, /same language and script as the user/);
        assert.doesNotMatch(sys, /PENDING-TEXT/);
        assert.doesNotMatch(sys, /SecretReviewerName/);
        assert.doesNotMatch(sys, /Attendance is strict/, 'other teachers are not needed for a specific question');
        assert.deepEqual(call.body.contents, [{ role: 'user', parts: [{ text: 'sir waqar ki grading kesi hai?\n\n(Reply in Roman Urdu, i.e. Urdu written in English letters.)' }] }]);
    });

    it('a general question gets a digest of every reviewed teacher', async () => {
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'who is the best teacher here?' });
        assert.equal(res.status, 200, res.text);
        const sys = systemText(fake.calls[0]);
        assert.match(sys, /Digest of reviewed teachers/);
        assert.match(sys, /Grading is fair/);
        assert.match(sys, /Attendance is strict/);
    });

    it('a general question about one aspect only carries excerpts about it', async () => {
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'which teachers are strict about attendance?' });
        assert.equal(res.status, 200, res.text);
        const sys = systemText(fake.calls[0]);
        assert.match(sys, /Attendance is strict/);
        assert.doesNotMatch(sys, /Grading is fair/);
        assert.match(sys, /have no review that mentions attendance/);
    });

    it('a question about the website does not send review data', async () => {
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'how do I write a review on this site?' });
        assert.equal(res.status, 200, res.text);
        const sys = systemText(fake.calls[0]);
        assert.doesNotMatch(sys, /Attendance is strict|Grading is fair/);
        assert.match(sys, /question about using the website/);
    });

    it('passes the conversation on and resolves follow-ups to the earlier teacher', async () => {
        const res = await createClient(server.baseUrl).post('/api/chat', {
            message: 'aur unki attendance?',
            history: [
                { role: 'assistant', text: 'Hi! Ask me about any UMT teacher.' },
                { role: 'user', text: 'sania qamar kaisi hain?' },
                { role: 'assistant', text: 'Students say she is organised.' }
            ]
        });
        assert.equal(res.status, 200, res.text);
        const call = fake.calls[0];
        // Leading assistant greeting dropped: Gemini needs a user turn first.
        assert.deepEqual(call.body.contents.map((c) => c.role), ['user', 'model', 'user']);
        assert.equal(call.body.contents[2].parts[0].text, 'aur unki attendance?\n\n(Reply in Roman Urdu, i.e. Urdu written in English letters.)');
        assert.match(systemText(call), /Attendance is strict/);
        assert.equal(res.body.teachers[0].id, sania);
    });

    it('uses the teacher page the user is on for "inki grading?"', async () => {
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'inki grading kesi hai?', teacherId: sania });
        assert.equal(res.status, 200, res.text);
        const sys = systemText(fake.calls[0]);
        assert.match(sys, /currently on the page of Sania Qamar/);
        assert.match(sys, /Attendance is strict/);
    });

    it('serves a repeated first question from cache', async () => {
        const client = createClient(server.baseUrl);
        const first = await client.post('/api/chat', { message: 'How do I write a review?' });
        const second = await createClient(server.baseUrl).post('/api/chat', { message: 'how do i  write a review?' });
        assert.equal(first.status, 200);
        assert.equal(second.status, 200);
        assert.equal(second.body.reply, first.body.reply);
        assert.deepEqual(second.body.teachers, first.body.teachers);
        assert.notEqual(second.body.replyToken, first.body.replyToken, 'each answer is signed for its own question');
        // Punctuation does not make it a different question either.
        const third = await createClient(server.baseUrl).post('/api/chat', { message: 'How do I write a review' });
        assert.equal(third.body.reply, first.body.reply);
        assert.equal(fake.calls.length, 1);
        assert.equal(fake.calls[0].body.generationConfig.maxOutputTokens, 1024, 'answers have a token cap');
        const saved = await dbQuery('SELECT COUNT(*) AS n FROM chat_answer_cache');
        assert.equal(saved[0].n >= 1, true, 'answer saved in the database too');
    });

    it('answers a Roman Urdu question in Roman Urdu, fixing an English answer cheaply', async () => {
        fake.queue.push(
            { status: 200, text: 'Based on the student reviews, attendance is strict.' },
            { status: 200, text: 'Students ke mutabiq attendance strict hai.' }
        );
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'sania qamar ki attendance policy kesi hai?' });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.reply, 'Students ke mutabiq attendance strict hai.');
        assert.equal(fake.calls.length, 2);
        const asked = fake.calls[0].body.contents.at(-1).parts[0].text;
        assert.match(asked, /Reply in Roman Urdu/, 'the question carries a language reminder');
        const fix = JSON.stringify(fake.calls[1].body.contents);
        assert.match(fix, /attendance is strict/);
        assert.doesNotMatch(fix, /lectures are organised/, 'the fix does not resend reviews');

        // An English question gets no reminder and no fix.
        fake.calls.length = 0;
        fake.queue.push({ status: 200, text: 'Students say attendance is strict.' });
        const en = await createClient(server.baseUrl).post('/api/chat', { message: 'What is the attendance policy of Sania Qamar?' });
        assert.equal(en.body.reply, 'Students say attendance is strict.');
        assert.equal(fake.calls.length, 1);
        assert.doesNotMatch(fake.calls[0].body.contents.at(-1).parts[0].text, /Reply in/);
    });

    it('validates input', async () => {
        const client = createClient(server.baseUrl);
        assert.equal((await client.post('/api/chat', { message: '   ' })).status, 400);
        assert.equal((await client.post('/api/chat', { message: 'x'.repeat(601) })).status, 400);
        assert.equal((await client.post('/api/chat', { message: 'hi', teacherId: 'abc' })).status, 400);
        assert.equal((await client.post('/api/chat', {})).status, 400);
        assert.equal(fake.calls.length, 0);
    });

    it('replies politely when Gemini blocks the answer', async () => {
        fake.queue.push({ status: 200, blocked: true });
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'something the safety filter blocks' });
        assert.equal(res.status, 200);
        assert.match(res.body.reply, /can't answer that/);
    });

    it('rate-limits one visitor', async () => {
        const client = createClient(server.baseUrl);
        const statuses = [];
        for (let i = 0; i < 5; i++) {
            statuses.push((await client.post('/api/chat', { message: `question number ${i} about bilal ahmed` })).status);
        }
        assert.deepEqual(statuses, [200, 200, 200, 200, 429]);
    });

    // Leaves model-a cooling down, so it runs after the tests that check model names.
    describe('ratings and usage', () => {
        const ask = async (client, message) => {
            const res = await client.post('/api/chat', { message });
            assert.equal(res.status, 200, res.text);
            assert.match(res.body.replyToken, /^\d+\.[A-Za-z0-9_-]{43}$/);
            return res.body;
        };
        const rate = (client, question, body, extra = {}) => client.post('/api/chat/feedback', {
            token: body.replyToken,
            question,
            answer: body.reply,
            teacherIds: body.teachers.map((t) => t.id),
            ...extra
        });

        it('stores a rating for a real answer and lets the user change it', async () => {
            const client = createClient(server.baseUrl);
            const question = 'sania qamar attendance kesi hai?';
            const body = await ask(client, question);
            const down = await rate(client, question, body, { rating: -1, comment: '  It   ignored the grading part. ' });
            assert.equal(down.status, 200, down.text);
            let rows = await dbQuery('SELECT rating, question, answer, teacher_ids, comment FROM chat_feedback');
            assert.equal(rows.length, 1);
            assert.deepEqual({ ...rows[0] }, { rating: -1, question, answer: body.reply, teacher_ids: String(sania), comment: 'It ignored the grading part.' });

            const up = await rate(client, question, body, { rating: 1, comment: 'ignored for a thumbs up' });
            assert.equal(up.status, 200);
            rows = await dbQuery('SELECT rating, comment FROM chat_feedback');
            assert.equal(rows.length, 1, 'same answer, same row');
            assert.deepEqual({ ...rows[0] }, { rating: 1, comment: null });
        });

        it('refuses a rating for an answer the server did not give', async () => {
            const client = createClient(server.baseUrl);
            const question = 'waqar ashiq quizzes kaise lete hain?';
            const body = await ask(client, question);
            const forgedAnswer = await rate(client, question, { ...body, reply: 'Something the bot never said.' }, { rating: -1 });
            assert.equal(forgedAnswer.status, 400);
            const forgedQuestion = await rate(client, 'a different question', body, { rating: -1 });
            assert.equal(forgedQuestion.status, 400);
            const forgedTeachers = await rate(client, question, { ...body, teachers: [{ id: 99999 }] }, { rating: -1 });
            assert.equal(forgedTeachers.status, 400);
            const badRating = await rate(client, question, body, { rating: 5 });
            assert.equal(badRating.status, 400);
            const noCsrf = await client.post('/api/chat/feedback', { token: body.replyToken, question, answer: body.reply, rating: 1 }, { csrf: false });
            assert.equal(noCsrf.status, 403);
            const [count] = await dbQuery('SELECT COUNT(*) AS n FROM chat_feedback WHERE question = ?', [question]);
            assert.equal(Number(count.n), 0);
        });

        it('cached answers get their own token', async () => {
            const question = 'bilal ahmed teaching kesi hai?';
            const first = await ask(createClient(server.baseUrl), question);
            const second = await ask(createClient(server.baseUrl), question);
            assert.equal(fake.calls.length, 1, 'second one came from the cache');
            assert.equal(second.reply, first.reply);
            const res = await rate(createClient(server.baseUrl), question, second, { rating: -1 });
            assert.equal(res.status, 200);
        });

        it('counts usage without storing question text, and shows it to admins only', async () => {
            const secret = 'kis teacher ki grading lenient hai PRIVATEWORD?';
            await ask(createClient(server.baseUrl), secret);
            const usage = await dbQuery('SELECT metric, mkey, count FROM chat_usage_daily');
            assert.ok(usage.length > 0);
            assert.ok(!usage.some((r) => /PRIVATEWORD/i.test(r.mkey)), 'question text is never a usage key');
            const metrics = new Set(usage.map((r) => `${r.metric}:${r.mkey}`));
            for (const expected of ['request:answered', 'request:cached', 'mode:general', 'mode:focused', 'lang:roman-urdu', 'aspect:grading', `teacher:${sania}`]) {
                assert.ok(metrics.has(expected), `missing ${expected}`);
            }

            assert.equal((await createClient(server.baseUrl).get('/api/admin/chat/insights')).status, 401);
            const admin = await createAdminAndLogin(server.baseUrl);
            const res = await admin.get('/api/admin/chat/insights?days=7');
            assert.equal(res.status, 200, res.text);
            assert.equal(res.body.available, true);
            assert.equal(res.body.days, 7);
            assert.equal(res.body.byDay.length, 7);
            assert.ok(res.body.byDay[6].questions >= 4);
            assert.ok(res.body.requests.answered >= 3);
            assert.ok(res.body.aspects.grading >= 1);
            assert.equal(res.body.topTeachers.find((t) => t.id === sania).name, 'Sania Qamar');
            assert.deepEqual(res.body.ratings, { up: 1, down: 1 });
            assert.equal(res.body.feedback[0].rating, -1, 'thumbs-down first');
            assert.deepEqual(res.body.feedback.find((f) => f.rating === 1).teachers, [{ id: sania, name: 'Sania Qamar' }]);

            const id = res.body.feedback[0].id;
            const noCsrf = await admin.del(`/api/admin/chat/feedback/${id}`, { csrf: false });
            assert.equal(noCsrf.status, 403);
            const del = await admin.del(`/api/admin/chat/feedback/${id}`);
            assert.equal(del.status, 200);
            assert.equal((await admin.del(`/api/admin/chat/feedback/${id}`)).status, 404);
            const after = await admin.get('/api/admin/chat/insights?days=7');
            assert.deepEqual(after.body.ratings, { up: 1, down: 0 });
        });
    });

    it('falls back to the next model when one is over quota, then skips the busy one', async () => {
        fake.queue.push({ status: 429 });
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'waqar ashiq exams kaise hote hain?' });
        assert.equal(res.status, 200, res.text);
        assert.deepEqual(fake.calls.map((c) => c.model), ['model-a', 'model-b']);
        assert.match(res.body.reply, /model model-b/);

        fake.calls.length = 0;
        const again = await createClient(server.baseUrl).post('/api/chat', { message: 'sania qamar quizzes?' });
        assert.equal(again.status, 200);
        assert.deepEqual(fake.calls.map((c) => c.model), ['model-b']);
    });

    it('says "busy" when every model is over quota', async () => {
        fake.queue.push({ status: 429 }, { status: 429 });
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'bilal ahmed assignments?' });
        assert.equal(res.status, 503);
        assert.equal(res.body.code, 'busy');
    });
});

describe('chat API without a key', { skip: SKIP }, () => {
    let server;
    before(async () => { server = await startServer({ GEMINI_API_KEY: '' }); });
    after(async () => { if (server) await server.stop(); });

    it('is reported disabled and refuses requests', async () => {
        const client = createClient(server.baseUrl);
        const status = await client.get('/api/chat/status');
        assert.equal(status.body.enabled, false);
        const res = await client.post('/api/chat', { message: 'hello' });
        assert.equal(res.status, 503);
        assert.equal(res.body.code, 'disabled');
    });
});
