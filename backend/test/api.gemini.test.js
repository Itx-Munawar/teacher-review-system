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
        server = await startServer({
            GEMINI_API_KEY: 'test-gemini-key',
            GEMINI_API_BASE: fake.url,
            GEMINI_MODELS: 'model-a,model-b',
            GEMINI_TIMEOUT_MS: '3000',
            CHAT_PER_MINUTE: '20'
        });
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

    it('reports total failure in the Errors tab', async () => {
        fake.queue.push({ status: 429 });
        const res = await createClient(server.baseUrl).post('/api/chat', { message: 'waqar ashiq attendance strict hai?' });
        assert.equal(res.status, 503, res.text);
        assert.equal(res.body.code, 'busy');
        await new Promise((r) => setTimeout(r, 300));
        const rows = await dbQuery("SELECT message FROM error_logs WHERE message LIKE 'Gemini unavailable:%'");
        assert.equal(rows.length, 1, JSON.stringify(rows));
        assert.match(rows[0].message, /model-b HTTP 429/);
    });
});
