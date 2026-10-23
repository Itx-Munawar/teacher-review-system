/**
 * Tests for the CSRF double-submit guard and the shared cookie SameSite rule
 * (backend/csrf.js).
 * Run: cd backend && node --test
 *
 * Covers: safe-method passthrough, token match/missing/mismatch, the
 * unequal-length case that must answer 403 instead of throwing out of
 * crypto.timingSafeEqual, malformed cookie values, and when a cookie is
 * allowed to be "None" rather than "Lax".
 */
const { test } = require('node:test');
const assert = require('node:assert');
const { csrfSetCookie, csrfValidate, sameSiteFor, CSRF_COOKIE_NAME } = require('./csrf');

const makeRes = () => {
    const res = {
        statusCode: 0,
        body: null,
        cookieSet: null,
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        cookie(name, value, options) { this.cookieSet = { name, value, options }; return this; }
    };
    return res;
};

const run = (req, res, middleware) => {
    let passed = false;
    middleware(req, res, () => { passed = true; });
    return passed;
};

const postWith = (cookieValue, headerValue) => {
    const headers = {};
    if (cookieValue !== undefined) headers.cookie = `${CSRF_COOKIE_NAME}=${cookieValue}`;
    if (headerValue !== undefined) headers['x-csrf-token'] = headerValue;
    return { method: 'POST', headers };
};

// ---------------------------------------------------------------------------
// Safe methods never need a token
// ---------------------------------------------------------------------------

test('GET/HEAD/OPTIONS pass without any CSRF token', () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) {
        const res = makeRes();
        assert.strictEqual(run({ method, headers: {} }, res, csrfValidate), true, method);
        assert.strictEqual(res.statusCode, 0);
    }
});

// ---------------------------------------------------------------------------
// Token comparison
// ---------------------------------------------------------------------------

test('matching cookie and header token is accepted', () => {
    const token = 'a'.repeat(64);
    const res = makeRes();
    assert.strictEqual(run(postWith(token, token), res, csrfValidate), true);
    assert.strictEqual(res.statusCode, 0);
});

test('missing header token is rejected with 403', () => {
    const res = makeRes();
    assert.strictEqual(run(postWith('a'.repeat(64), undefined), res, csrfValidate), false);
    assert.strictEqual(res.statusCode, 403);
    assert.match(res.body.error, /missing/i);
});

test('missing cookie is rejected with 403', () => {
    const res = makeRes();
    assert.strictEqual(run(postWith(undefined, 'a'.repeat(64)), res, csrfValidate), false);
    assert.strictEqual(res.statusCode, 403);
});

test('unequal length tokens get 403 instead of throwing from timingSafeEqual', () => {
    // crypto.timingSafeEqual throws RangeError when buffer lengths differ.
    // A forged short header used to become a 500 and an exception log line.
    const res = makeRes();
    assert.doesNotThrow(() => run(postWith('a'.repeat(64), 'b'.repeat(8)), res, csrfValidate));
    assert.strictEqual(res.statusCode, 403);
    assert.match(res.body.error, /mismatch/i);
});

test('same length but different tokens get 403', () => {
    const res = makeRes();
    assert.strictEqual(run(postWith('a'.repeat(64), 'b'.repeat(64)), res, csrfValidate), false);
    assert.strictEqual(res.statusCode, 403);
});

test('a malformed percent-escape in the cookie does not crash validation', () => {
    const res = makeRes();
    // decodeURIComponent('%zz') throws; the guard must swallow it so the
    // request is judged on its tokens, not answered with a 500.
    assert.doesNotThrow(() => run(postWith('%zznotatoken', 'whateverelse1'), res, csrfValidate));
    assert.strictEqual(res.statusCode, 403);
});

// ---------------------------------------------------------------------------
// SameSite decision
// ---------------------------------------------------------------------------

test('insecure requests never get SameSite=None', () => {
    const req = { headers: { origin: 'https://evil.example', host: 'api.example.com' } };
    assert.strictEqual(sameSiteFor(req, false), 'lax');
});

test('same-site request over https gets lax', () => {
    const req = {
        headers: {
            origin: 'https://teacher-review-system-zeta.vercel.app',
            'x-forwarded-host': 'teacher-review-system-zeta.vercel.app'
        }
    };
    assert.strictEqual(sameSiteFor(req, true), 'lax');
});

test('different subdomains of one registrable domain are same-site', () => {
    const req = {
        headers: { origin: 'https://foo.vercel.app', host: 'bar.vercel.app' }
    };
    assert.strictEqual(sameSiteFor(req, true), 'lax');
});

test('ports do not make localhost cross-site', () => {
    const req = { headers: { origin: 'http://localhost:3000', host: 'localhost:5000' } };
    assert.strictEqual(sameSiteFor(req, true), 'lax');
});

test('cross-site request over https needs None to be sent at all', () => {
    const req = {
        headers: {
            origin: 'https://attacker.example',
            'x-forwarded-host': 'teacher-review-system-zeta.vercel.app'
        }
    };
    assert.strictEqual(sameSiteFor(req, true), 'none');
});

test('request without an Origin falls back to the stricter lax', () => {
    const req = { headers: { host: 'teacher-review-system.onrender.com' } };
    assert.strictEqual(sameSiteFor(req, true), 'lax');
});

test('an unparseable Origin does not throw', () => {
    const req = { headers: { origin: 'not a url', host: 'teacher-review-system.onrender.com' } };
    assert.strictEqual(sameSiteFor(req, true), 'lax');
});

test('a comma separated forwarded host uses the first entry', () => {
    const req = {
        headers: {
            origin: 'https://teacher-review-system-zeta.vercel.app',
            'x-forwarded-host': 'teacher-review-system-zeta.vercel.app, 10.0.0.1'
        }
    };
    assert.strictEqual(sameSiteFor(req, true), 'lax');
});

// ---------------------------------------------------------------------------
// Cookie issuance
// ---------------------------------------------------------------------------

test('csrf cookie is set once per client and follows the SameSite rule', () => {
    const res = makeRes();
    const req = {
        secure: false,
        headers: { origin: 'https://attacker.example', host: 'teacher-review-system.onrender.com' }
    };
    run(req, res, csrfSetCookie);
    assert.ok(res.cookieSet, 'expected a cookie to be set');
    assert.strictEqual(res.cookieSet.name, CSRF_COOKIE_NAME);
    assert.strictEqual(res.cookieSet.options.httpOnly, false);
    assert.strictEqual(res.cookieSet.options.sameSite, 'lax');
    assert.match(res.cookieSet.value, /^[0-9a-f]{64}$/);
});

test('an existing csrf cookie is not overwritten', () => {
    const res = makeRes();
    const req = { secure: false, headers: { cookie: `${CSRF_COOKIE_NAME}=alreadyhere` } };
    run(req, res, csrfSetCookie);
    assert.strictEqual(res.cookieSet, null);
});
