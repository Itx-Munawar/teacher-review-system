// Admin API: setup, login, sessions, CSRF, 2FA and moderation.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
    SKIP, SETUP_KEY, ADMIN, resetDatabase, dbQuery, startServer, createClient, createAdminAndLogin, totpNow
} = require('../testing/apiHarness');

describe('admin API', { skip: SKIP }, () => {
    let server;
    let admin; // logged-in client
    let teacherId;

    before(async () => {
        await resetDatabase();
        const t = await dbQuery("INSERT INTO teachers (name, department) VALUES ('Sana Iqbal', 'School of Law')");
        teacherId = t.insertId;
        server = await startServer();
        admin = await createAdminAndLogin(server.baseUrl);
    });

    after(async () => {
        if (server) await server.stop();
    });

    describe('setup', () => {
        it('refuses a second account without a session', async () => {
            const stranger = createClient(server.baseUrl);
            await stranger.primeCsrf();
            const res = await stranger.post(
                '/api/admin/setup',
                { username: 'intruder', password: 'Another-Password-1', email: 'x@example.com' },
                { headers: { 'X-Setup-Secret': SETUP_KEY } }
            );
            assert.equal(res.status, 403);
        });

        it('rejects a wrong setup key', async () => {
            const stranger = createClient(server.baseUrl);
            await stranger.primeCsrf();
            const res = await stranger.post(
                '/api/admin/setup',
                { username: 'a', password: 'b', email: 'c' },
                { headers: { 'X-Setup-Secret': 'wrong' } }
            );
            assert.equal(res.status, 401);
        });
    });

    describe('login and session', () => {
        it('sets an HttpOnly session cookie on login', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            const res = await client.post('/api/admin/login', { username: ADMIN.username, password: ADMIN.password });
            assert.equal(res.status, 200);
            const cookie = res.headers.getSetCookie().find((c) => c.startsWith('admin_token='));
            assert.ok(cookie, 'admin_token cookie set');
            assert.match(cookie, /HttpOnly/i);
            assert.match(cookie, /SameSite=Lax/i);
        });

        it('requires the CSRF header to log in', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            const res = await client.post('/api/admin/login', { username: ADMIN.username, password: ADMIN.password }, { csrf: false });
            assert.equal(res.status, 403);
            assert.equal(res.body.error, 'CSRF token missing');
        });

        it('rejects a mismatched CSRF header', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            const res = await client.post(
                '/api/admin/login',
                { username: ADMIN.username, password: ADMIN.password },
                { csrf: false, headers: { 'X-CSRF-Token': 'a'.repeat(64) } }
            );
            assert.equal(res.status, 403);
            assert.equal(res.body.error, 'CSRF token mismatch');
        });

        it('gives the same answer for a wrong password and an unknown user', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            const wrongPass = await client.post('/api/admin/login', { username: ADMIN.username, password: 'nope-nope-1' });
            const noUser = await client.post('/api/admin/login', { username: 'ghost', password: 'nope-nope-1' });
            assert.equal(wrongPass.status, 401);
            assert.deepEqual(wrongPass.body, noUser.body);
            await dbQuery('UPDATE admins SET failed_attempts = 0, locked_until = NULL');
        });

        it('rejects non-string credentials', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            const res = await client.post('/api/admin/login', { username: ['admin'], password: { $gt: '' } });
            assert.equal(res.status, 400);
        });

        it('GET /api/admin/me works with the cookie and fails without', async () => {
            const me = await admin.get('/api/admin/me');
            assert.equal(me.status, 200);
            assert.equal(me.body.admin.username, ADMIN.username);
            assert.equal(me.headers.get('cache-control'), 'no-store');

            const anon = await createClient(server.baseUrl).get('/api/admin/me');
            assert.equal(anon.status, 401);
        });

        it('rejects a forged token', async () => {
            const res = await createClient(server.baseUrl).get('/api/admin/me', {
                headers: { Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJpZCI6MX0.' }
            });
            assert.equal(res.status, 403);
        });

        it('logout clears the cookie', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            await client.post('/api/admin/login', { username: ADMIN.username, password: ADMIN.password });
            assert.ok(client.jar.has('admin_token'));
            const out = await client.post('/api/admin/logout', {});
            assert.equal(out.status, 200);
            assert.ok(!client.jar.has('admin_token'));
            assert.equal((await client.get('/api/admin/me')).status, 401);
        });

        it('forgot-password answers the same for unknown emails', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            const res = await client.post('/api/admin/forgot-password', { email: 'nobody@example.com' });
            assert.equal(res.status, 200);
            assert.equal(res.body.message, 'If that email exists, we sent a reset link.');
        });

        it('every admin route rejects anonymous callers', async () => {
            const anon = createClient(server.baseUrl);
            for (const p of ['/api/admin/reviews', '/api/admin/questions', '/api/admin/stats', '/api/admin/reports', '/api/admin/audit-logs', '/api/admin/custom-courses', '/api/admin/search-gaps']) {
                const res = await anon.get(p);
                assert.equal(res.status, 401, p);
            }
        });
    });

    describe('teachers', () => {
        let newId;

        it('adds a teacher', async () => {
            const res = await admin.post('/api/admin/teachers', { name: 'Usman Tariq', department: 'School of Law' });
            assert.equal(res.status, 200);
            newId = res.body.id;
            const pub = await createClient(server.baseUrl).get(`/api/teachers/${newId}`);
            assert.equal(pub.body.teacher.name, 'Usman Tariq');
        });

        it('validates teacher fields', async () => {
            const res = await admin.post('/api/admin/teachers', { name: 'U', department: 'School of Law' });
            assert.equal(res.status, 400);
        });

        it('updates a teacher', async () => {
            const res = await admin.put(`/api/admin/teachers/${newId}`, { name: 'Usman Tariq Khan', department: 'School of Law' });
            assert.equal(res.status, 200);
            const detail = await admin.get(`/api/admin/teachers/${newId}`);
            assert.equal(detail.status, 200);
            const name = detail.body.teacher ? detail.body.teacher.name : detail.body.name;
            assert.equal(name, 'Usman Tariq Khan');
        });

        it('deletes a teacher and their reviews', async () => {
            await dbQuery("INSERT INTO reviews (teacher_id, comment, is_approved) VALUES (?, 'Review that should go with the teacher.', 1)", [newId]);
            const res = await admin.del(`/api/admin/teachers/${newId}`);
            assert.equal(res.status, 200);
            const rows = await dbQuery('SELECT COUNT(*) AS n FROM reviews WHERE teacher_id = ?', [newId]);
            assert.equal(rows[0].n, 0);
            assert.equal((await createClient(server.baseUrl).get(`/api/teachers/${newId}`)).status, 404);
        });

        it('state changes need CSRF even with a valid session', async () => {
            const res = await admin.post('/api/admin/teachers', { name: 'No Csrf', department: 'School of Law' }, { csrf: false });
            assert.equal(res.status, 403);
        });
    });

    describe('review moderation', () => {
        let reviewId;

        before(async () => {
            const student = createClient(server.baseUrl);
            const res = await student.post('/api/reviews', { teacher_id: teacherId, comment: 'Clear lectures, fair grading overall.' });
            reviewId = res.body.review_id;
        });

        it('lists pending reviews', async () => {
            const res = await admin.get('/api/admin/reviews?pending=1');
            assert.equal(res.status, 200);
            const list = res.body.reviews || [];
            assert.ok(list.some((r) => r.id === reviewId));
        });

        it('approving a review makes it public', async () => {
            const res = await admin.put(`/api/admin/reviews/${reviewId}`, { is_approved: true });
            assert.equal(res.status, 200);
            const pub = await createClient(server.baseUrl).get(`/api/teachers/${teacherId}`);
            assert.ok(pub.body.reviews.some((r) => r.id === reviewId));
        });

        it('approval is written to the audit log with a hashed IP', async () => {
            const rows = await dbQuery("SELECT ip_address FROM audit_logs WHERE action = 'APPROVE_REVIEW' ORDER BY id DESC LIMIT 1");
            assert.equal(rows.length, 1);
            assert.notEqual(rows[0].ip_address, admin.ip);
            const logs = await admin.get('/api/admin/audit-logs?action=APPROVE_REVIEW');
            assert.equal(logs.status, 200);
        });

        it('edits and then deletes a review', async () => {
            const edit = await admin.put(`/api/admin/reviews/${reviewId}`, { comment: 'Edited by a moderator for clarity.' });
            assert.equal(edit.status, 200);
            const del = await admin.del(`/api/admin/reviews/${reviewId}`);
            assert.equal(del.status, 200);
            assert.equal((await admin.del(`/api/admin/reviews/${reviewId}`)).status, 404);
        });

        it('stats reflect the data', async () => {
            const res = await admin.get('/api/admin/stats');
            assert.equal(res.status, 200);
            assert.equal(typeof res.body.total_reviews, 'number');
            assert.equal(typeof res.body.pending_reviews, 'number');
        });
    });

    describe('two-factor authentication', () => {
        let secret;

        it('enrolls with a live code', async () => {
            const setup = await admin.post('/api/admin/2fa/setup', {});
            assert.equal(setup.status, 200);
            secret = setup.body.secret;
            assert.match(setup.body.otpauth_uri, /^otpauth:\/\/totp\//);

            const wrong = await admin.post('/api/admin/2fa/enable', { code: '000000' === totpNow(secret) ? '111111' : '000000' });
            assert.equal(wrong.status, 401);

            const ok = await admin.post('/api/admin/2fa/enable', { code: totpNow(secret) });
            assert.equal(ok.status, 200);
            assert.equal((await admin.get('/api/admin/me')).body.admin.totp_enabled, 1);
        });

        it('login then asks for the code and accepts a valid one', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            const step1 = await client.post('/api/admin/login', { username: ADMIN.username, password: ADMIN.password });
            assert.equal(step1.status, 200);
            assert.deepEqual(step1.body, { requires_totp: true });
            assert.ok(!client.jar.has('admin_token'));

            const bad = await client.post('/api/admin/login', { username: ADMIN.username, password: ADMIN.password, totp_code: '12345x' });
            assert.equal(bad.status, 401);

            const step2 = await client.post('/api/admin/login', {
                username: ADMIN.username, password: ADMIN.password, totp_code: totpNow(secret)
            });
            assert.equal(step2.status, 200);
            assert.ok(client.jar.has('admin_token'));
        });

        it('can be disabled again', async () => {
            const res = await admin.post('/api/admin/2fa/disable', {});
            assert.equal(res.status, 200);
            assert.equal((await admin.get('/api/admin/me')).body.admin.totp_enabled, 0);
        });
    });

    describe('lockout', () => {
        it('locks the account after 5 wrong passwords', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            for (let i = 0; i < 5; i += 1) {
                await client.post('/api/admin/login', { username: ADMIN.username, password: `wrong-password-${i}` });
            }
            const [row] = await dbQuery('SELECT failed_attempts, locked_until FROM admins WHERE username = ?', [ADMIN.username]);
            assert.equal(row.failed_attempts, 5);
            assert.ok(row.locked_until && new Date(row.locked_until) > new Date());
            await dbQuery('UPDATE admins SET failed_attempts = 0, locked_until = NULL');
        });

        it('refuses even the right password while locked, without extending the lock', async () => {
            await dbQuery('UPDATE admins SET failed_attempts = 5, locked_until = DATE_ADD(NOW(), INTERVAL 10 MINUTE) WHERE username = ?', [ADMIN.username]);
            const [before] = await dbQuery('SELECT locked_until FROM admins WHERE username = ?', [ADMIN.username]);
            const client = createClient(server.baseUrl);
            await client.primeCsrf();

            const right = await client.post('/api/admin/login', { username: ADMIN.username, password: ADMIN.password });
            assert.equal(right.status, 429);
            assert.match(right.body.error, /Too many failed attempts\. Try again in (10|11) minutes/);
            assert.ok(Number(right.headers.get('retry-after')) > 0);
            assert.equal(client.jar.has('admin_token'), false);
            assert.equal((await client.get('/api/admin/me')).status, 401);

            const wrong = await client.post('/api/admin/login', { username: ADMIN.username, password: 'still-wrong-1' });
            assert.equal(wrong.status, 429);
            const [after] = await dbQuery('SELECT failed_attempts, locked_until FROM admins WHERE username = ?', [ADMIN.username]);
            assert.equal(after.failed_attempts, 5);
            assert.equal(new Date(after.locked_until).getTime(), new Date(before.locked_until).getTime());
            await dbQuery('UPDATE admins SET failed_attempts = 0, locked_until = NULL');
        });

        it('lets the admin back in once the lock expires, with a fresh count', async () => {
            await dbQuery('UPDATE admins SET failed_attempts = 5, locked_until = DATE_SUB(NOW(), INTERVAL 1 MINUTE) WHERE username = ?', [ADMIN.username]);
            const client = createClient(server.baseUrl);
            await client.primeCsrf();

            const wrong = await client.post('/api/admin/login', { username: ADMIN.username, password: 'wrong-again-1' });
            assert.equal(wrong.status, 401);
            const [mid] = await dbQuery('SELECT failed_attempts, locked_until FROM admins WHERE username = ?', [ADMIN.username]);
            assert.equal(mid.failed_attempts, 1);
            assert.equal(mid.locked_until, null);

            const right = await client.post('/api/admin/login', { username: ADMIN.username, password: ADMIN.password });
            assert.equal(right.status, 200);
            const [row] = await dbQuery('SELECT failed_attempts, locked_until FROM admins WHERE username = ?', [ADMIN.username]);
            assert.equal(row.failed_attempts, 0);
            assert.equal(row.locked_until, null);
        });

        it('a password reset unlocks the account at once', async () => {
            const crypto = require('node:crypto');
            const token = crypto.randomBytes(32).toString('hex');
            const hash = crypto.createHash('sha256').update(token).digest('hex');
            await dbQuery(
                `UPDATE admins SET failed_attempts = 5, locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE),
                        reset_token = ?, reset_token_expires = DATE_ADD(NOW(), INTERVAL 1 HOUR) WHERE username = ?`,
                [hash, ADMIN.username]
            );
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            const reset = await client.post('/api/admin/reset-password', { token, newPassword: ADMIN.password });
            assert.equal(reset.status, 200, reset.text);
            const login = await client.post('/api/admin/login', { username: ADMIN.username, password: ADMIN.password });
            assert.equal(login.status, 200);
        });
    });
});
