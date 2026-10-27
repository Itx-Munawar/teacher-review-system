// Minimal Gemini REST client (no SDK) with model fallback.
//
// Free-tier quotas are per model, so when one model answers 429 the next one
// in GEMINI_MODELS is tried, and the busy model is skipped for a while
// instead of being hit again on every request.

const { logJson: log } = require('./log');

const API_BASE = String(process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
// Flash-Lite models have the largest free daily quota.
const MODELS = String(process.env.GEMINI_MODELS || 'gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-2.5-flash-lite')
    .split(',').map((m) => m.trim()).filter(Boolean);
// Per-model wait. A healthy model answers in a few seconds; one that hangs
// longer is overloaded, and the next model is a better bet than waiting.
const TIMEOUT_MS = Math.max(3000, parseInt(process.env.GEMINI_TIMEOUT_MS, 10) || 15000);
// Total time one request may spend across all models, so a visitor never
// waits minutes for "busy".
const TOTAL_BUDGET_MS = Math.max(TIMEOUT_MS, parseInt(process.env.GEMINI_TOTAL_BUDGET_MS, 10) || 40000);
const COOLDOWN_MS = 60 * 1000;
// A model that timed out is skipped for longer than a rate-limited one:
// retrying it straight away would make the next visitor wait again.
const TIMEOUT_COOLDOWN_MS = 3 * 60 * 1000;

// When every model fails the reason is stored in the admin Errors tab (lazy
// require: errorTracker pulls in the database layer).
const reportFailure = (attempts) => {
    try {
        require('./errorTracker').recordError({
            source: 'backend',
            message: `Gemini unavailable: ${attempts.join('; ')}`.slice(0, 500)
        }).catch(() => {});
    } catch (_) { /* never let reporting break the request */ }
};

const cooldownUntil = new Map();

class GeminiError extends Error {
    constructor(message, { status = 0, kind = 'error' } = {}) {
        super(message);
        this.name = 'GeminiError';
        this.status = status;
        // 'busy': every model is rate-limited/unavailable; 'config': bad key
        // or model; 'blocked': safety filter; 'error': anything else.
        this.kind = kind;
    }
}

const isConfigured = () => Boolean(process.env.GEMINI_API_KEY);

const callModel = async (model, payload, timeoutMs = TIMEOUT_MS) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(`${API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': process.env.GEMINI_API_KEY
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        });
        const text = await res.text();
        let data = null;
        try { data = JSON.parse(text); } catch { /* non-JSON error page */ }
        return { status: res.status, data };
    } finally {
        clearTimeout(timer);
    }
};

/**
 * @param {{ system: string, contents: Array<{role:'user'|'model', parts:[{text:string}]}>, maxOutputTokens?: number }} req
 * @returns {Promise<{ text: string, model: string }>}
 */
const generate = async ({ system, contents, maxOutputTokens = 2048, temperature = 0.4, responseMimeType }) => {
    if (!isConfigured()) throw new GeminiError('Gemini API key is not configured', { kind: 'config' });
    const payload = {
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: { temperature, maxOutputTokens, ...(responseMimeType ? { responseMimeType } : {}) }
    };

    const now = Date.now();
    const available = MODELS.filter((m) => (cooldownUntil.get(m) || 0) <= now);
    // Everything cooling down: still try the one that frees up first rather
    // than refusing outright (the cooldown is a guess, not Google's number).
    const order = available.length ? available
        : [...MODELS].sort((a, b) => (cooldownUntil.get(a) || 0) - (cooldownUntil.get(b) || 0)).slice(0, 1);

    let lastError = null;
    const attempts = [];
    const requestStarted = Date.now();
    for (const model of order) {
        const remaining = TOTAL_BUDGET_MS - (Date.now() - requestStarted);
        if (remaining < 3000) {
            attempts.push(`${model} skipped (time budget used)`);
            break;
        }
        const started = Date.now();
        let result;
        try {
            result = await callModel(model, payload, Math.min(TIMEOUT_MS, remaining));
        } catch (err) {
            const timedOut = err && err.name === 'AbortError';
            log('warn', 'gemini_request_failed', { model, reason: timedOut ? 'timeout' : String(err && err.message), ms: Date.now() - started });
            cooldownUntil.set(model, Date.now() + (timedOut ? TIMEOUT_COOLDOWN_MS : COOLDOWN_MS));
            attempts.push(`${model} ${timedOut ? `timeout after ${Math.round((Date.now() - started) / 1000)}s` : 'unreachable'}`);
            lastError = new GeminiError(timedOut ? 'Gemini timed out' : 'Gemini unreachable', { kind: 'busy' });
            continue;
        }
        const { status, data } = result;
        if (status === 200) {
            const candidate = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
            const text = candidate && candidate.content && Array.isArray(candidate.content.parts)
                ? candidate.content.parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('').trim()
                : '';
            const finish = candidate && candidate.finishReason;
            log('info', 'gemini_ok', {
                model,
                ms: Date.now() - started,
                finish,
                in_tokens: data && data.usageMetadata && data.usageMetadata.promptTokenCount,
                out_tokens: data && data.usageMetadata && data.usageMetadata.candidatesTokenCount
            });
            if (text) return { text, model, truncated: finish === 'MAX_TOKENS' };
            const blocked = (data && data.promptFeedback && data.promptFeedback.blockReason) || finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT';
            if (blocked) throw new GeminiError('Response blocked by safety filter', { status, kind: 'blocked' });
            attempts.push(`${model} empty (${finish || 'no candidate'})`);
            lastError = new GeminiError(`Empty response (${finish || 'no candidate'})`, { status });
            continue;
        }
        const apiMessage = data && data.error && data.error.message ? String(data.error.message).slice(0, 200) : '';
        log('warn', 'gemini_error', { model, status, message: apiMessage });
        attempts.push(`${model} HTTP ${status}${apiMessage ? ` ${apiMessage.slice(0, 80)}` : ''}`);
        if (status === 429 || status === 503 || status === 500 || status === 504) {
            cooldownUntil.set(model, Date.now() + COOLDOWN_MS);
            lastError = new GeminiError('Gemini is busy', { status, kind: 'busy' });
            continue;
        }
        if (status === 404) {
            // Model retired or misspelled: skip it for a long time, try the next.
            cooldownUntil.set(model, Date.now() + 60 * COOLDOWN_MS);
            lastError = new GeminiError(`Model ${model} not available`, { status, kind: 'config' });
            continue;
        }
        // 400/401/403: bad key, bad request - the next model will fail the same way.
        reportFailure(attempts);
        throw new GeminiError(apiMessage || `Gemini error ${status}`, { status, kind: status === 400 ? 'error' : 'config' });
    }
    reportFailure(attempts.length ? attempts : ['no model available']);
    throw lastError || new GeminiError('No Gemini model available', { kind: 'busy' });
};

const _resetCooldowns = () => cooldownUntil.clear();

module.exports = { generate, isConfigured, GeminiError, MODELS, _resetCooldowns };
