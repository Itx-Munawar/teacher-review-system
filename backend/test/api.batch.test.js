// Helpful votes, review sort/course filter, AI summaries, analytics, error
// tracking and bulk reply moderation - against the real server and MySQL.
const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SKIP, resetDatabase, dbQuery, startServer, createClient, createAdminAndLogin } = require('../testing/apiHarness');
const { startFakeGemini } = require('../testing/fakeGemini');

const SUMMARY_JSON = (overview) => JSON.stringify({
    overview,
    pros: ['Concepts clear karte hain', 'Grading fair hai'],
    cons: ['Attendance strict hai']
});

describe('review extras, summaries, analytics and errors', { skip: SKIP }, () => {
    let server;
    let fake;
    let admin;
    let waqar;
    let sania;
    let bilal;
    const reviewIds = [];

    before(async () => {
        await resetDatabase();
        waqar = (await dbQuery("INSERT INTO teachers (name, department) VALUES ('Waqar Ashiq', 'School of Systems and Technology')")).insertId;
        sania = (await dbQuery("INSERT INTO teachers (name, department) VALUES ('Sania Qamar', 'School of Law')")).insertId;
        bilal = (await dbQuery("INSERT INTO teachers (name, department) VALUES ('Bilal Ahmed', 'School of Systems and Technology')")).insertId;
        const hira = (await dbQuery("INSERT INTO teachers (name, department) VALUES ('Kinza Translate', 'School of Law')")).insertId;
        for (const n of [1, 2, 3]) {
            await dbQuery("INSERT INTO reviews (teacher_id, comment, user_name, is_approved) VALUES (?, ?, 'Anonymous', 1)", [hira, `Kinza review number ${n}, explains well.`]);
        }
        const rows = [
            ['Explains calculus clearly, grading fair.', 'SecretReviewer', ['Calculus I'], '2026-01-01 10:00:00'],
            ['Strict attendance but good lectures.', null, ['Calculus I', 'Linear Algebra'], '2026-01-02 10:00:00'],
            ['Quizzes are tough, 100% attendance needed.', null, ['Linear Algebra'], '2026-01-03 10:00:00'],
            ['Best teacher for discrete maths.', null, ['Discrete Structures'], '2026-01-04 10:00:00']
        ];
        for (const [comment, name, courses, at] of rows) {
            const r = await dbQuery(
                'INSERT INTO reviews (teacher_id, comment, user_name, courses, is_approved, created_at) VALUES (?, ?, ?, ?, 1, ?)',
                [waqar, comment, name || 'Anonymous', JSON.stringify(courses), at]
            );
            reviewIds.push(r.insertId);
        }
        await dbQuery("INSERT INTO reviews (teacher_id, comment, is_approved) VALUES (?, 'PENDING-SECRET not public yet.', 0)", [waqar]);
        await dbQuery("INSERT INTO reviews (teacher_id, comment, is_approved) VALUES (?, 'Only one review here.', 1)", [sania]);

        fake = await startFakeGemini();
        server = await startServer({
            GEMINI_API_KEY: 'test-gemini-key',
            GEMINI_API_BASE: fake.url,
            GEMINI_MODELS: 'model-a',
            SUMMARY_RETRY_AFTER_MS: '1500'
        });
        admin = await createAdminAndLogin(server.baseUrl);
    });

    after(async () => {
        if (server) await server.stop();
        if (fake) await fake.close();
    });

    beforeEach(() => { fake.calls.length = 0; fake.queue.length = 0; });

    // ---------- helpful votes ----------
    describe('helpful votes', () => {
        it('counts one vote per browser and can be undone', async () => {
            const a = createClient(server.baseUrl);
            const b = createClient(server.baseUrl);
            const target = reviewIds[0];

            let res = await a.post(`/api/reviews/${target}/helpful`, {});
            assert.equal(res.status, 200, res.text);
            assert.deepEqual([res.body.voted, res.body.helpful_count], [true, 1]);
            assert.match(a.jar.get('vid'), /^[0-9a-f]{32}$/);

            res = await a.post(`/api/reviews/${target}/helpful`, {});
            assert.equal(res.body.helpful_count, 1, 'second vote from the same browser is ignored');

            res = await b.post(`/api/reviews/${target}/helpful`, {});
            assert.equal(res.body.helpful_count, 2);

            res = await b.del(`/api/reviews/${target}/helpful`);
            assert.deepEqual([res.body.voted, res.body.helpful_count], [false, 1]);
            res = await b.del(`/api/reviews/${target}/helpful`);
            assert.equal(res.body.helpful_count, 1, 'removing twice does not go below the real count');

            const detailA = await a.get(`/api/teachers/${waqar}`);
            const mine = detailA.body.reviews.find((r) => r.id === target);
            assert.deepEqual([mine.helpful_count, mine.voted], [1, true]);
            const detailB = await b.get(`/api/teachers/${waqar}`);
            assert.equal(detailB.body.reviews.find((r) => r.id === target).voted, false);

            const stored = await dbQuery('SELECT voter_hash FROM review_votes WHERE review_id = ?', [target]);
            assert.equal(stored.length, 1);
            assert.notEqual(stored[0].voter_hash, a.jar.get('vid'), 'only a hash of the cookie is stored');
        });

        it('rejects votes on pending or unknown reviews and without CSRF', async () => {
            const c = createClient(server.baseUrl);
            const [pending] = await dbQuery('SELECT id FROM reviews WHERE is_approved = 0 LIMIT 1');
            assert.equal((await c.post(`/api/reviews/${pending.id}/helpful`, {})).status, 404);
            assert.equal((await c.post('/api/reviews/999999/helpful', {})).status, 404);
            assert.equal((await c.post('/api/reviews/abc/helpful', {})).status, 400);
            assert.equal((await c.post(`/api/reviews/${reviewIds[1]}/helpful`, {}, { csrf: false })).status, 403);
        });

        it('sorts by most helpful when asked', async () => {
            const voters = [createClient(server.baseUrl), createClient(server.baseUrl), createClient(server.baseUrl)];
            for (const v of voters) await v.post(`/api/reviews/${reviewIds[2]}/helpful`, {});

            const newest = await createClient(server.baseUrl).get(`/api/teachers/${waqar}?review_sort=newest`);
            assert.equal(newest.body.reviews[0].id, reviewIds[3]);
            assert.equal(newest.body.review_sort, 'newest');

            // Most helpful is the default.
            for (const url of [`/api/teachers/${waqar}`, `/api/teachers/${waqar}?review_sort=helpful`]) {
                const helpful = await createClient(server.baseUrl).get(url);
                assert.equal(helpful.body.review_sort, 'helpful');
                assert.deepEqual(helpful.body.reviews.slice(0, 2).map((r) => r.id), [reviewIds[2], reviewIds[0]]);
            }
        });
    });

    // ---------- course filter ----------
    describe('course filter', () => {
        it('lists course chips from all approved reviews and filters by course', async () => {
            const c = createClient(server.baseUrl);
            const all = await c.get(`/api/teachers/${waqar}?review_limit=1`);
            assert.equal(all.status, 200);
            assert.deepEqual(all.body.course_counts, [
                { course: 'Calculus I', count: 2 },
                { course: 'Linear Algebra', count: 2 },
                { course: 'Discrete Structures', count: 1 }
            ]);
            assert.equal(all.body.total_reviews, 4);

            const calc = await c.get(`/api/teachers/${waqar}?review_course=${encodeURIComponent('Calculus I')}`);
            assert.equal(calc.body.reviews.length, 2);
            assert.ok(calc.body.reviews.every((r) => JSON.stringify(r.courses).includes('Calculus I')));
            assert.equal(calc.body.filtered_reviews, 2);
            assert.equal(calc.body.total_reviews, 4, 'overall total is unchanged by the filter');
            assert.equal(calc.body.review_course, 'Calculus I');
            assert.equal(calc.body.review_pagination.total, 2);
        });

        it('treats LIKE wildcards in the course as plain text', async () => {
            const res = await createClient(server.baseUrl).get(`/api/teachers/${waqar}?review_course=${encodeURIComponent('%')}`);
            assert.equal(res.body.reviews.length, 0);
            const under = await createClient(server.baseUrl).get(`/api/teachers/${waqar}?review_course=_`);
            assert.equal(under.body.reviews.length, 0);
        });
    });

    // ---------- AI summary ----------
    describe('AI summary', () => {
        it('needs at least three approved reviews', async () => {
            const res = await createClient(server.baseUrl).get(`/api/teachers/${sania}/summary`);
            assert.equal(res.status, 200);
            assert.deepEqual([res.body.available, res.body.reason], [false, 'few_reviews']);
            assert.equal(fake.calls.length, 0);
            assert.equal((await createClient(server.baseUrl).get('/api/teachers/999999/summary')).status, 404);
        });

        it('generates once, then serves the cached summary', async () => {
            fake.queue.push({ status: 200, text: SUMMARY_JSON('Zyada tar students khush hain.') });
            const c = createClient(server.baseUrl);
            const first = await c.get(`/api/teachers/${waqar}/summary`);
            assert.equal(first.status, 200, first.text);
            assert.equal(first.body.available, true);
            assert.equal(first.body.overview, 'Zyada tar students khush hain.');
            assert.deepEqual(first.body.pros, ['Concepts clear karte hain', 'Grading fair hai']);
            assert.equal(first.body.review_count, 4);
            assert.match(first.headers.get('cache-control'), /max-age=300/);

            assert.equal(fake.calls.length, 1);
            const call = fake.calls[0];
            assert.equal(call.body.generationConfig.responseMimeType, 'application/json');
            const prompt = JSON.stringify(call.body.contents);
            assert.match(prompt, /Explains calculus clearly/);
            assert.doesNotMatch(prompt, /PENDING-SECRET/, 'pending reviews never reach the model');
            assert.doesNotMatch(prompt, /SecretReviewer/, 'reviewer names never reach the model');
            assert.match(call.body.systemInstruction.parts[0].text, /Roman Urdu/);

            const second = await c.get(`/api/teachers/${waqar}/summary`);
            assert.equal(second.body.overview, 'Zyada tar students khush hain.');
            assert.equal(fake.calls.length, 1, 'cached: no second model call');
        });

        it('keeps the saved summary when an existing review is edited', async () => {
            await dbQuery("UPDATE reviews SET comment = CONCAT(comment, ' Edited later with more words.') WHERE teacher_id = ? AND is_approved = 1 ORDER BY id LIMIT 1", [waqar]);
            const res = await createClient(server.baseUrl).get(`/api/teachers/${waqar}/summary`);
            assert.equal(res.body.overview, 'Zyada tar students khush hain.');
            assert.equal(res.body.stale, undefined);
            assert.equal(fake.calls.length, 0, 'edits do not spend AI quota');
        });

        it('regenerates after a new review is approved, and falls back to the old one on failure', async () => {
            const r = await dbQuery("INSERT INTO reviews (teacher_id, comment, is_approved) VALUES (?, 'Very helpful in office hours.', 0)", [waqar]);
            // Pending review: signature unchanged, still cached.
            await createClient(server.baseUrl).get(`/api/teachers/${waqar}/summary`);
            assert.equal(fake.calls.length, 0);

            const res = await admin.put(`/api/admin/reviews/${r.insertId}`, { is_approved: true });
            assert.equal(res.status, 200, res.text);

            fake.queue.push({ status: 503 });
            const stale = await createClient(server.baseUrl).get(`/api/teachers/${waqar}/summary`);
            assert.equal(stale.body.available, true);
            assert.equal(stale.body.stale, true);
            assert.equal(stale.body.overview, 'Zyada tar students khush hain.');
            assert.equal(stale.headers.get('cache-control'), 'no-store');

            // Right after a failure the saved summary is served without asking again.
            fake.calls.length = 0;
            const again = await createClient(server.baseUrl).get(`/api/teachers/${waqar}/summary`);
            assert.equal(again.body.stale, true);
            assert.equal(fake.calls.length, 0, 'failure back-off: no immediate retry');

            await new Promise((r) => setTimeout(r, 1600));
            fake.queue.push({ status: 200, text: SUMMARY_JSON('Naya khulasa.') });
            const fresh = await createClient(server.baseUrl).get(`/api/teachers/${waqar}/summary`);
            assert.equal(fresh.body.overview, 'Naya khulasa.');
            assert.equal(fresh.body.review_count, 5);
            assert.equal(fresh.body.stale, undefined);
            assert.equal(fake.calls.length, 1);
        });

        it('translates an English summary to Roman Urdu with a small second call', async () => {
            const [{ id: hira }] = await dbQuery("SELECT id FROM teachers WHERE name = 'Kinza Translate'");
            fake.queue.push(
                { status: 200, text: JSON.stringify({ overview: 'Most students say she explains concepts clearly.', pros: ['Clear lectures'], cons: [] }) },
                { status: 200, text: JSON.stringify({ overview: 'Zyada tar students kehte hain ke concepts clear karti hain.', pros: ['Lectures clear hoti hain'], cons: [] }) }
            );
            const res = await createClient(server.baseUrl).get(`/api/teachers/${hira}/summary`);
            assert.equal(res.body.overview, 'Zyada tar students kehte hain ke concepts clear karti hain.');
            assert.equal(fake.calls.length, 2);
            const second = JSON.stringify(fake.calls[1].body.contents);
            assert.match(second, /Most students say/);
            assert.doesNotMatch(second, /Kinza review/, 'the translation call does not resend the reviews');
        });

        it('keeps old Roman Urdu summaries without an AI call, rebuilds old English ones', async () => {
            const [{ id: hira }] = await dbQuery("SELECT id FROM teachers WHERE name = 'Kinza Translate'");
            const legacy = 'a'.repeat(40);
            await dbQuery('UPDATE teacher_summaries SET signature = ? WHERE teacher_id = ?', [legacy, hira]);
            const kept = await createClient(server.baseUrl).get(`/api/teachers/${hira}/summary`);
            assert.equal(kept.body.overview, 'Zyada tar students kehte hain ke concepts clear karti hain.');
            assert.equal(fake.calls.length, 0);
            const [row] = await dbQuery('SELECT signature FROM teacher_summaries WHERE teacher_id = ?', [hira]);
            assert.match(row.signature, /^n:\d+$/);

            await dbQuery('UPDATE teacher_summaries SET signature = ?, summary = ? WHERE teacher_id = ?',
                [legacy, JSON.stringify({ overview: 'Students appreciate the teacher a lot.', pros: ['Kind'], cons: [] }), hira]);
            fake.queue.push({ status: 200, text: SUMMARY_JSON('Students bohat khush hain.') });
            const rebuilt = await createClient(server.baseUrl).get(`/api/teachers/${hira}/summary`);
            assert.equal(rebuilt.body.overview, 'Students bohat khush hain.');
            assert.equal(fake.calls.length, 1);
        });

        it('rejects unusable model output without caching it', async () => {
            await dbQuery("INSERT INTO reviews (teacher_id, comment, is_approved) VALUES (?, 'Good one.', 1), (?, 'Nice teacher.', 1), (?, 'Average.', 1)", [bilal, bilal, bilal]);
            fake.queue.push({ status: 200, text: 'not json at all' });
            const res = await createClient(server.baseUrl).get(`/api/teachers/${bilal}/summary`);
            assert.deepEqual([res.body.available, res.body.reason], [false, 'busy']);
            const rows = await dbQuery('SELECT * FROM teacher_summaries WHERE teacher_id = ?', [bilal]);
            assert.equal(rows.length, 0);
        });
    });

    // ---------- analytics ----------
    describe('analytics', () => {
        it('counts visits, profile views and searches anonymously', async () => {
            const c = createClient(server.baseUrl);
            assert.equal((await c.post('/api/track', { type: 'visit' })).status, 204);
            assert.equal((await c.post('/api/track', { type: 'visit' })).status, 204);
            for (let i = 0; i < 6; i += 1) await c.post('/api/track', { type: 'teacher_view', teacher_id: bilal });
            await c.post('/api/track', { type: 'teacher_view', teacher_id: waqar });
            assert.equal((await c.post('/api/track', { type: 'teacher_view', teacher_id: 999999 })).status, 204);
            assert.equal((await c.post('/api/track', { type: 'nope' })).status, 400);
            assert.equal((await c.post('/api/track', { type: 'teacher_view', teacher_id: 'x' })).status, 400);
            assert.equal((await c.post('/api/track', { type: 'visit' }, { csrf: false })).status, 403);
            // Crawlers are not counted.
            await c.post('/api/track', { type: 'visit' }, { headers: { 'User-Agent': 'Googlebot/2.1' } });

            await c.get('/api/teachers/search?q=Waqar');
            await c.get('/api/teachers/search?q=nobody%20here');
            await c.get('/api/teachers/search?q=ab');

            // Search counters are written without delaying the response.
            for (let i = 0; i < 30; i += 1) {
                const [{ n }] = await dbQuery('SELECT COUNT(*) AS n FROM search_terms_daily');
                if (Number(n) >= 2) break;
                await new Promise((r) => setTimeout(r, 100));
            }
            const [visits] = await dbQuery('SELECT SUM(visits) AS n FROM site_visits_daily');
            assert.equal(Number(visits.n), 2);
            const unknown = await dbQuery('SELECT * FROM teacher_views_daily WHERE teacher_id = 999999');
            assert.equal(unknown.length, 0);
            const terms = await dbQuery('SELECT term, results FROM search_terms_daily ORDER BY term');
            assert.deepEqual(terms.map((t) => [t.term, Number(t.results)]), [['nobody here', 0], ['waqar', 1]]);
        });

        it('serves the admin analytics report', async () => {
            assert.equal((await createClient(server.baseUrl).get('/api/admin/analytics')).status, 401);
            const res = await admin.get('/api/admin/analytics?days=7');
            assert.equal(res.status, 200, res.text);
            assert.equal(res.body.available, true);
            assert.equal(res.body.days, 7);
            assert.equal(res.body.daily.length, 7);
            assert.equal(res.body.totals.visits, 2);
            assert.equal(res.body.totals.teacher_views, 7);
            assert.ok(res.body.totals.helpful_votes >= 4);
            assert.deepEqual(res.body.top_teachers.map((t) => [t.name, t.views]), [['Bilal Ahmed', 6], ['Waqar Ashiq', 1]]);
            assert.deepEqual(res.body.needs_reviews.map((t) => t.name), []);
            assert.deepEqual(res.body.top_searches.map((t) => t.term).sort(), ['nobody here', 'waqar']);
            const sst = res.body.departments.find((d) => d.department === 'School of Systems and Technology');
            assert.deepEqual([sst.teachers, sst.reviewed_teachers, sst.views], [2, 2, 7]);

            // Unknown windows fall back to 30 days.
            const fallback = await admin.get('/api/admin/analytics?days=12');
            assert.equal(fallback.body.days, 30);
        });

        it('flags popular teachers with few reviews', async () => {
            const lone = (await dbQuery("INSERT INTO teachers (name, department) VALUES ('Zara Lone', 'School of Law')")).insertId;
            const c = createClient(server.baseUrl);
            for (let i = 0; i < 3; i += 1) await c.post('/api/track', { type: 'teacher_view', teacher_id: lone });
            const res = await admin.get('/api/admin/analytics?days=30');
            assert.deepEqual(res.body.needs_reviews.map((t) => [t.name, t.views, t.reviews]), [['Zara Lone', 3, 0]]);
        });
    });

    // ---------- error tracking ----------
    describe('error tracking', () => {
        it('stores browser errors grouped by fingerprint and ignores noise', async () => {
            const c = createClient(server.baseUrl);
            const report = { message: "TypeError: Cannot read properties of undefined (reading 'name')", stack: 'TypeError: x\n    at TeacherCard (https://site/assets/index-abc.js:10:5)', url: 'https://site/teacher/12?x=1' };
            assert.equal((await c.post('/api/client-errors', report)).status, 204);
            assert.equal((await c.post('/api/client-errors', { message: 'ResizeObserver loop limit exceeded' })).status, 204);
            assert.equal((await c.post('/api/client-errors', {})).status, 400);
            assert.equal((await c.post('/api/client-errors', report, { csrf: false })).status, 403);

            const rows = await dbQuery("SELECT source, message, path, resolved FROM error_logs WHERE source = 'frontend'");
            assert.equal(rows.length, 1);
            assert.equal(rows[0].path, '/teacher/12');
            assert.match(rows[0].message, /Cannot read properties/);
        });

        it('captures handled server errors with the request path', async () => {
            await dbQuery('RENAME TABLE questions TO questions_hidden');
            try {
                const res = await createClient(server.baseUrl).get(`/api/teachers/${waqar}/questions`);
                assert.equal(res.status, 500);
                await new Promise((r) => setTimeout(r, 300));
            } finally {
                await dbQuery('RENAME TABLE questions_hidden TO questions');
            }
            const rows = await dbQuery("SELECT method, path, message FROM error_logs WHERE source = 'backend'");
            const hit = rows.find((r) => r.path === `/api/teachers/${waqar}/questions`);
            assert.ok(hit, JSON.stringify(rows));
            assert.equal(hit.method, 'GET');
        });

        it('lets the admin list, resolve and delete errors', async () => {
            assert.equal((await createClient(server.baseUrl).get('/api/admin/errors')).status, 401);
            let res = await admin.get('/api/admin/errors?status=open');
            assert.equal(res.status, 200);
            assert.ok(res.body.errors.length >= 2);
            const stats = await admin.get('/api/admin/stats');
            assert.equal(stats.body.open_errors, res.body.pagination.total);

            const [first, second] = res.body.errors;
            assert.equal((await admin.put(`/api/admin/errors/${first.id}`, { resolved: true })).status, 200);
            assert.equal((await admin.put(`/api/admin/errors/${first.id}`, { resolved: 'yes' })).status, 400);
            res = await admin.get('/api/admin/errors?status=resolved');
            assert.deepEqual(res.body.errors.map((e) => e.id), [first.id]);

            assert.equal((await admin.del(`/api/admin/errors/${second.id}`)).status, 200);
            assert.equal((await admin.del(`/api/admin/errors/${second.id}`)).status, 404);

            res = await admin.post('/api/admin/errors/resolve-all', {});
            assert.equal(res.status, 200);
            assert.equal((await admin.get('/api/admin/stats')).body.open_errors, 0);
        });
    });

    // ---------- bulk replies ----------
    describe('bulk reply moderation', () => {
        it('approves, hides and deletes many replies at once', async () => {
            const ids = [];
            for (const text of ['Agree with this', 'Same experience', 'Not true for me']) {
                const r = await dbQuery('INSERT INTO review_replies (review_id, reply, is_approved) VALUES (?, ?, 0)', [reviewIds[0], text]);
                ids.push(r.insertId);
            }
            let res = await admin.post('/api/admin/replies/bulk', { ids: [ids[0], ids[1]], action: 'approve' });
            assert.equal(res.status, 200, res.text);
            assert.equal(res.body.affected, 2);
            let detail = await createClient(server.baseUrl).get(`/api/teachers/${waqar}`);
            const shown = detail.body.reviews.find((r) => r.id === reviewIds[0]).replies.map((x) => x.reply).sort();
            assert.deepEqual(shown, ['Agree with this', 'Same experience']);

            res = await admin.post('/api/admin/replies/bulk', { ids: [ids[1]], action: 'hide' });
            assert.equal(res.body.affected, 1);
            res = await admin.post('/api/admin/replies/bulk', { ids: [ids[2]], action: 'delete' });
            assert.equal(res.body.affected, 1);
            const left = await dbQuery(`SELECT id, is_approved FROM review_replies WHERE id IN (${ids.join(',')}) ORDER BY id`);
            assert.deepEqual(left.map((r) => [r.id, r.is_approved]), [[ids[0], 1], [ids[1], 0]]);

            const audit = await dbQuery("SELECT action FROM audit_logs WHERE action LIKE 'BULK_%' ORDER BY id");
            assert.deepEqual(audit.map((a) => a.action), ['BULK_APPROVE_REPLIES', 'BULK_HIDE_REPLIES', 'BULK_DELETE_REPLIES']);

            assert.equal((await admin.post('/api/admin/replies/bulk', { ids: [], action: 'approve' })).status, 400);
            assert.equal((await admin.post('/api/admin/replies/bulk', { ids: [ids[0]], action: 'explode' })).status, 400);
            assert.equal((await createClient(server.baseUrl).post('/api/admin/replies/bulk', { ids: [ids[0]], action: 'delete' })).status, 401);
        });
    });
});
