// Gemini resilience: a hanging model must not make every visitor wait for
// its timeout, and total failures must show up in the admin Errors tab.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SKIP, resetDatabase, dbQuery, startServer, createClient } = require('../testing/apiHarness');
const { startFakeGemini } = require('../testing/fakeGemini');

describe('Gemini timeouts and fallback', { skip: SKIP }, () => {
    let server;
    let fake;

    before(async () => {
        await resetDatabase();
        await dbQuery("INSERT INTO teachers (name, department) VALUES ('Waqar Ashiq', 'School of Systems and Technology')");
        fake = await startFakeGemini();
        const env = {
            GEMINI_API_KEY: 'test-gemini-key',
            GEMINI_API_BASE: fake.url,
            GEMINI_MODELS: 'model-a,model-b',
            GEMINI_TIMEOUT_MS: '3000',
            CHAT_PER_MINUTE: '20'
        };
        server = await startServer(env);
        server.env = env;
    });

    after(async () => {
        if (server) await server.stop();
        if (fake) await fake.close();
    });

    beforeEach(() => { fake.calls.length = 0; fake.queue.length = 0; });

    it('falls back after a timeout and then skips the hanging model', async () => {
        fake.queue.push({ status: 200, delay: 4500, text: 'too slow' }, { status: 200, text: 'Answer from model b.' });
        const started = Date.now();
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'waqar ashiq ki teaching kesi hai?' });
        assert.equal(res.status, 200, res.text);
        assert.equal(res.body.reply, 'Answer from model b.');
        assert.deepEqual(fake.calls.map((c) => c.model), ['model-a', 'model-b']);
        assert.ok(Date.now() - started < 4500, 'gave up on model-a at the 3s timeout');

        fake.calls.length = 0;
        const second = await createClient(server.baseUrl).post('/api/chat', { message: 'waqar ashiq ke quizzes kese hain?' });
        assert.equal(second.status, 200, second.text);
        assert.deepEqual(fake.calls.map((c) => c.model), ['model-b'], 'model-a is cooling down after its timeout');
    });

    it('serves a saved answer after a server restart, until new reviews arrive', async () => {
        fake.queue.push({ status: 200, text: 'Saved answer about Waqar.' });
        const q = { message: 'waqar ashiq ka grading style?' };
        const first = await createClient(server.baseUrl).post('/api/chat', q);
        assert.equal(first.body.reply, 'Saved answer about Waqar.');
        assert.equal(fake.calls.length, 1);

        // A fresh server process has an empty memory cache: the DB answers.
        const env = server.env;
        await server.stop();
        server = await startServer(env);
        server.env = env;
        fake.calls.length = 0;
        const again = await createClient(server.baseUrl).post('/api/chat', q);
        assert.equal(again.status, 200, again.text);
        assert.equal(again.body.reply, 'Saved answer about Waqar.');
        assert.equal(fake.calls.length, 0, 'no AI call for a saved answer');

        // A new approved review changes the data version: the answer is rebuilt.
        const [{ id }] = await dbQuery("SELECT id FROM teachers WHERE name = 'Waqar Ashiq'");
        await dbQuery("INSERT INTO reviews (teacher_id, comment, user_name, is_approved) VALUES (?, 'Grading is very fair and quick.', 'Anonymous', 1)", [id]);
        await server.stop();
        server = await startServer(env);
        server.env = env;
        fake.queue.push({ status: 200, text: 'Fresh answer with the new review.' });
        const fresh = await createClient(server.baseUrl).post('/api/chat', q);
        assert.equal(fresh.body.reply, 'Fresh answer with the new review.');
        assert.equal(fake.calls.length, 1);
    });

    it('reports total failure in the Errors tab', async () => {
        fake.queue.push({ status: 429 }, { status: 429 });
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'waqar ashiq attendance strict hai?' });
        assert.equal(res.status, 503, res.text);
        assert.equal(res.body.code, 'busy');
        await new Promise((r) => setTimeout(r, 300));
        const rows = await dbQuery("SELECT message FROM error_logs WHERE message LIKE 'Gemini unavailable:%'");
        assert.equal(rows.length, 1, JSON.stringify(rows));
        assert.match(rows[0].message, /model-a HTTP 429/);
        assert.match(rows[0].message, /model-b HTTP 429/);
    });
});
