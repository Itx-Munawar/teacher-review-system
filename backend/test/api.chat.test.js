// Chat assistant API against the real server, with a fake Gemini endpoint
// that records what it was sent and replies as scripted.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { SKIP, resetDatabase, dbQuery, startServer, createClient } = require('../testing/apiHarness');

const startFakeGemini = async () => {
    const calls = [];
    const queue = []; // scripted responses, consumed in order; default = success
    const server = http.createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            const body = raw ? JSON.parse(raw) : null;
            const model = decodeURIComponent((req.url.match(/models\/([^:]+):generateContent/) || [])[1] || '');
            calls.push({ url: req.url, model, key: req.headers['x-goog-api-key'], body });
            const next = queue.shift() || { status: 200, text: `Students say good things. (model ${model})` };
            res.writeHead(next.status, { 'Content-Type': 'application/json' });
            if (next.status !== 200) return res.end(JSON.stringify({ error: { code: next.status, message: 'Resource has been exhausted' } }));
            if (next.blocked) return res.end(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }));
            res.end(JSON.stringify({
                candidates: [{ content: { role: 'model', parts: [{ text: next.text }] }, finishReason: 'STOP' }],
                usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 }
            }));
        });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
        url: `http://127.0.0.1:${server.address().port}`,
        calls,
        queue,
        close: () => new Promise((resolve) => server.close(resolve))
    };
};

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
        assert.deepEqual(call.body.contents, [{ role: 'user', parts: [{ text: 'sir waqar ki grading kesi hai?' }] }]);
    });

    it('a general question sends every reviewed teacher', async () => {
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'which teachers are strict about attendance?' });
        assert.equal(res.status, 200, res.text);
        const sys = systemText(fake.calls[0]);
        assert.match(sys, /Grading is fair/);
        assert.match(sys, /Attendance is strict/);
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
        assert.equal(call.body.contents[2].parts[0].text, 'aur unki attendance?');
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
        assert.deepEqual(second.body, first.body);
        assert.equal(fake.calls.length, 1);
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
