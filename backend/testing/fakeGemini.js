// Fake Gemini generateContent endpoint for API tests. It records every call
// (model, API key, request body) and replies from a scripted queue; with an
// empty queue it answers with a short success text.
const http = require('node:http');

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
            const next = queue.shift() || { status: 200, text: `Students say good things, sab kehte hain acha parhate hain. (model ${model})` };
            const respond = () => {
                res.writeHead(next.status, { 'Content-Type': 'application/json' });
                if (next.status !== 200) return res.end(JSON.stringify({ error: { code: next.status, message: 'Resource has been exhausted' } }));
                if (next.blocked) return res.end(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }));
                res.end(JSON.stringify({
                    candidates: [{ content: { role: 'model', parts: [{ text: next.text }] }, finishReason: 'STOP' }],
                    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 }
                }));
            };
            // `delay` (ms) simulates a slow / hanging model.
            if (next.delay) setTimeout(respond, next.delay); else respond();
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

module.exports = { startFakeGemini };
