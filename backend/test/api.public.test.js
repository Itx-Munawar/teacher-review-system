// Public API: what students and crawlers can reach without logging in.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { SKIP, resetDatabase, dbQuery, startServer, createClient } = require('../testing/apiHarness');

describe('public API', { skip: SKIP }, () => {
    let server;
    let teacherA;
    let teacherB;
    let approvedReviewId;

    before(async () => {
        await resetDatabase();
        const a = await dbQuery("INSERT INTO teachers (name, department) VALUES ('Ayesha Khan', 'School of Science')");
        const b = await dbQuery("INSERT INTO teachers (name, department) VALUES ('Bilal Ahmed', 'School of Business')");
        await dbQuery("INSERT INTO teachers (name, department) VALUES ('Muhammad Ali', 'School of Science')");
        teacherA = a.insertId;
        teacherB = b.insertId;
        const r = await dbQuery(
            "INSERT INTO reviews (teacher_id, comment, user_name, courses, is_approved) VALUES (?, ?, 'Student', ?, 1)",
            [teacherA, 'Explains every concept clearly and fairly.', JSON.stringify(['Calculus I'])]
        );
        approvedReviewId = r.insertId;
        // Pending reviews must never be visible publicly.
        await dbQuery(
            "INSERT INTO reviews (teacher_id, comment, is_approved, moderation_flag) VALUES (?, 'This one is still waiting for moderation.', 0, 'profanity')",
            [teacherA]
        );
        server = await startServer();
    });

    after(async () => {
        if (server) await server.stop();
    });

    describe('health', () => {
        it('GET /api/health is OK without touching the DB', async () => {
            const res = await createClient(server.baseUrl).get('/api/health');
            assert.equal(res.status, 200);
            assert.equal(res.body.status, 'OK');
        });

        it('GET /api/ready checks the database', async () => {
            const res = await createClient(server.baseUrl).get('/api/ready');
            assert.equal(res.status, 200);
            assert.equal(res.body.status, 'ready');
        });

        it('hands out a readable CSRF cookie', async () => {
            const client = createClient(server.baseUrl);
            await client.get('/api/health');
            assert.match(client.jar.get('csrf_token'), /^[0-9a-f]{64}$/);
        });
    });

    describe('teachers', () => {
        it('lists teachers with approved review counts only', async () => {
            const res = await createClient(server.baseUrl).get('/api/teachers');
            assert.equal(res.status, 200);
            assert.equal(res.body.pagination.total, 3);
            const ayesha = res.body.teachers.find((t) => t.id === teacherA);
            assert.equal(ayesha.review_count, 1);
            assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
        });

        it('filters by department and sorts by review count', async () => {
            const client = createClient(server.baseUrl);
            const dept = await client.get('/api/teachers?department=' + encodeURIComponent('School of Business'));
            assert.deepEqual(dept.body.teachers.map((t) => t.name), ['Bilal Ahmed']);
            const sorted = await client.get('/api/teachers?sort=reviews');
            assert.equal(sorted.body.teachers[0].id, teacherA);
        });

        it('filters by course from approved reviews', async () => {
            const res = await createClient(server.baseUrl).get('/api/teachers?course=calculus');
            assert.deepEqual(res.body.teachers.map((t) => t.id), [teacherA]);
        });

        it('clamps bad pagination instead of erroring', async () => {
            const res = await createClient(server.baseUrl).get('/api/teachers?page=-5&limit=99999');
            assert.equal(res.status, 200);
            assert.equal(res.body.pagination.page, 1);
            assert.equal(res.body.pagination.limit, 200);
        });

        it('lists departments with counts', async () => {
            const res = await createClient(server.baseUrl).get('/api/departments');
            assert.equal(res.status, 200);
            assert.deepEqual(res.body, [
                { department: 'School of Business', teacher_count: 1 },
                { department: 'School of Science', teacher_count: 2 }
            ]);
        });

        it('returns home page stats counting approved reviews only', async () => {
            const res = await createClient(server.baseUrl).get('/api/stats');
            assert.equal(res.status, 200);
            assert.deepEqual(res.body, { teachers: 3, departments: 2, reviews: 1, reviewed_teachers: 1 });
            assert.equal(res.headers.get('cache-control'), 'public, max-age=60');
        });

        it('returns one teacher with approved reviews and no moderation fields', async () => {
            const res = await createClient(server.baseUrl).get(`/api/teachers/${teacherA}`);
            assert.equal(res.status, 200);
            assert.equal(res.body.teacher.name, 'Ayesha Khan');
            assert.equal(res.body.total_reviews, 1);
            assert.equal(res.body.reviews.length, 1);
            assert.equal(res.body.reviews[0].id, approvedReviewId);
            assert.ok(!('moderation_flag' in res.body.reviews[0]));
        });

        it('400s on a malformed id and 404s on an unknown one', async () => {
            const client = createClient(server.baseUrl);
            assert.equal((await client.get('/api/teachers/abc')).status, 400);
            assert.equal((await client.get('/api/teachers/999999')).status, 404);
        });

        it('lists related teachers from the same department', async () => {
            const res = await createClient(server.baseUrl).get(`/api/teachers/${teacherA}/related`);
            assert.equal(res.status, 200);
            const names = (Array.isArray(res.body) ? res.body : res.body.teachers || []).map((t) => t.name);
            assert.ok(names.includes('Muhammad Ali'));
            assert.ok(!names.includes('Ayesha Khan'));
        });
    });

    describe('search', () => {
        it('finds by name prefix, ranks exact-ish matches first', async () => {
            const res = await createClient(server.baseUrl).get('/api/teachers/search?q=ayesha');
            assert.equal(res.status, 200);
            assert.equal(res.body[0].name, 'Ayesha Khan');
        });

        it('matches misspellings via SOUNDEX', async () => {
            const res = await createClient(server.baseUrl).get('/api/teachers/search?q=Muhamad');
            assert.ok(res.body.some((t) => t.name === 'Muhammad Ali'));
        });

        it('treats LIKE wildcards as literal text', async () => {
            const client = createClient(server.baseUrl);
            assert.deepEqual((await client.get('/api/teachers/search?q=%25')).body, []);
            assert.deepEqual((await client.get('/api/teachers/search?q=_')).body, []);
        });

        it('returns [] for an empty query and 400 for an overlong one', async () => {
            const client = createClient(server.baseUrl);
            assert.deepEqual((await client.get('/api/teachers/search?q=')).body, []);
            assert.equal((await client.get('/api/teachers/search?q=' + 'x'.repeat(101))).status, 400);
        });
    });

    describe('CSRF on public forms', () => {
        const forms = () => [
            ['/api/reviews', { teacher_id: teacherB, comment: 'Forged review from another site.' }],
            ['/api/questions', { question: 'Is this a forged question from elsewhere?' }],
            ['/api/questions/1/answers', { answer: 'Forged answer text' }],
            ['/api/reviews/1/replies', { reply: 'Forged reply text' }],
            ['/api/custom-courses', { name: 'Forged Course' }],
        ];

        it('refuses every public form without the token', async () => {
            for (const [url, body] of forms()) {
                const client = createClient(server.baseUrl);
                await client.primeCsrf(); // has the cookie, but a forged request cannot read it
                const res = await client.post(url, body, { csrf: false });
                assert.equal(res.status, 403, url);
                assert.equal(res.body.error, 'CSRF token missing', url);
            }
        });

        it('refuses a wrong token and a cookie-less request', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            const wrong = await client.post('/api/reviews', forms()[0][1], { csrf: false, headers: { 'X-CSRF-Token': 'b'.repeat(64) } });
            assert.equal(wrong.status, 403);
            assert.equal(wrong.body.error, 'CSRF token mismatch');
            const bare = await createClient(server.baseUrl).post('/api/reviews', forms()[0][1], { csrf: false });
            assert.equal(bare.status, 403);
        });

        it('a refused request does not use up the review rate limit', async () => {
            const client = createClient(server.baseUrl);
            await client.primeCsrf();
            for (let i = 0; i < 12; i += 1) {
                await client.post('/api/reviews', forms()[0][1], { csrf: false });
            }
            const real = await client.post('/api/reviews', { teacher_id: teacherB, comment: 'Genuine review after forged attempts.' });
            assert.equal(real.status, 200, real.text);
        });
    });

    describe('reviews', () => {
        it('accepts a valid review as pending', async () => {
            const res = await createClient(server.baseUrl).post('/api/reviews', {
                teacher_id: teacherB,
                comment: 'Assignments are tough but the feedback is useful.',
                courses: ['Marketing 101']
            });
            assert.equal(res.status, 200);
            assert.equal(res.body.pending, true);
            const [row] = await dbQuery('SELECT is_approved, user_name, courses FROM reviews WHERE id = ?', [res.body.review_id]);
            assert.equal(row.is_approved, 0);
            assert.equal(row.user_name, 'Anonymous');
            assert.deepEqual(JSON.parse(row.courses), ['Marketing 101']);
        });

        it('pending reviews do not show up publicly', async () => {
            const res = await createClient(server.baseUrl).get(`/api/teachers/${teacherB}`);
            assert.equal(res.body.total_reviews, 0);
        });

        it('rejects reviews that are too short', async () => {
            const res = await createClient(server.baseUrl).post('/api/reviews', { teacher_id: teacherB, comment: 'bad' });
            assert.equal(res.status, 400);
            assert.equal(res.body.code, 'VALIDATION_ERROR');
            assert.match(res.body.error, /between 5 and 1000/);
        });

        it('accepts a five-character review but not five punctuation marks', async () => {
            const client = createClient(server.baseUrl);
            const ok = await client.post('/api/reviews', { teacher_id: teacherA, comment: 'Great' });
            assert.equal(ok.status, 200, ok.text);
            const four = await client.post('/api/reviews', { teacher_id: teacherA, comment: 'Good' });
            assert.equal(four.status, 400);
            const noise = await client.post('/api/reviews', { teacher_id: teacherA, comment: '!!!!!' });
            assert.equal(noise.status, 400);
        });

        it('404s for an unknown teacher', async () => {
            const res = await createClient(server.baseUrl).post('/api/reviews', {
                teacher_id: 999999,
                comment: 'A perfectly reasonable review text.'
            });
            assert.equal(res.status, 404);
        });

        it('blocks the same text twice for one teacher, ignoring case and punctuation', async () => {
            const client = createClient(server.baseUrl);
            const first = await client.post('/api/reviews', { teacher_id: teacherB, comment: 'Very helpful during office hours' });
            assert.equal(first.status, 200);
            const again = await client.post('/api/reviews', { teacher_id: teacherB, comment: 'very helpful during office hours!!' });
            assert.equal(again.status, 409);
            assert.equal(again.body.code, 'DUPLICATE_REVIEW');
        });

        it('rate-limits one IP after 10 reviews in 15 minutes', async () => {
            const client = createClient(server.baseUrl);
            const statuses = [];
            for (let i = 0; i < 11; i += 1) {
                const res = await client.post('/api/reviews', { teacher_id: teacherB, comment: `Rate limit probe number ${i} for testing` });
                statuses.push(res.status);
            }
            assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
            assert.equal(statuses[10], 429);
        });
    });

    describe('review replies', () => {
        let pendingReviewId;
        before(async () => {
            const r = await dbQuery(
                "INSERT INTO reviews (teacher_id, comment, is_approved) VALUES (?, 'Pending review used for reply tests.', 0)",
                [teacherA]
            );
            pendingReviewId = r.insertId;
        });

        it('accepts a reply as pending and hides it until approved', async () => {
            const client = createClient(server.baseUrl);
            const res = await client.post(`/api/reviews/${approvedReviewId}/replies`, { reply: '  Agreed, her notes are great.  ', user_name: 'Hamza' });
            assert.equal(res.status, 200, res.text);
            assert.equal(res.body.pending, true);
            const [row] = await dbQuery('SELECT reply, user_name, is_approved FROM review_replies WHERE id = ?', [res.body.reply_id]);
            assert.equal(row.reply, 'Agreed, her notes are great.');
            assert.equal(row.user_name, 'Hamza');
            assert.equal(row.is_approved, 0);

            let detail = await client.get(`/api/teachers/${teacherA}`);
            let review = detail.body.reviews.find((r) => r.id === approvedReviewId);
            assert.deepEqual(review.replies, []);

            await dbQuery('UPDATE review_replies SET is_approved = 1 WHERE id = ?', [res.body.reply_id]);
            detail = await client.get(`/api/teachers/${teacherA}`);
            review = detail.body.reviews.find((r) => r.id === approvedReviewId);
            assert.equal(review.replies.length, 1);
            assert.equal(review.replies[0].reply, 'Agreed, her notes are great.');
            assert.equal(review.replies[0].user_name, 'Hamza');
            assert.equal(review.replies[0].is_approved, undefined, 'moderation columns stay private');
            assert.equal(review.replies[0].moderation_flag, undefined);
        });

        it('defaults the name to Anonymous and blocks duplicate text', async () => {
            const client = createClient(server.baseUrl);
            const first = await client.post(`/api/reviews/${approvedReviewId}/replies`, { reply: 'Same here!' });
            assert.equal(first.status, 200);
            const [row] = await dbQuery('SELECT user_name FROM review_replies WHERE id = ?', [first.body.reply_id]);
            assert.equal(row.user_name, 'Anonymous');
            const again = await client.post(`/api/reviews/${approvedReviewId}/replies`, { reply: 'same here' });
            assert.equal(again.status, 409);
            assert.equal(again.body.code, 'DUPLICATE_REPLY');
        });

        it('validates length and refuses pending or missing reviews', async () => {
            const client = createClient(server.baseUrl);
            assert.equal((await client.post(`/api/reviews/${approvedReviewId}/replies`, { reply: 'k' })).status, 400);
            assert.equal((await client.post(`/api/reviews/${approvedReviewId}/replies`, { reply: '?!' })).status, 400);
            assert.equal((await client.post(`/api/reviews/${approvedReviewId}/replies`, { reply: 'x'.repeat(501) })).status, 400);
            assert.equal((await client.post(`/api/reviews/${approvedReviewId}/replies`, { reply: { a: 1 } })).status, 400);
            assert.equal((await client.post(`/api/reviews/${pendingReviewId}/replies`, { reply: 'Replying to a pending one' })).status, 404);
            assert.equal((await client.post('/api/reviews/999999/replies', { reply: 'Replying to nothing' })).status, 404);
            assert.equal((await client.post('/api/reviews/abc/replies', { reply: 'Bad id here' })).status, 400);
        });

        it('the old report endpoint is gone', async () => {
            const res = await createClient(server.baseUrl).post(`/api/reviews/${approvedReviewId}/report`, { reason: 'spam spam' });
            assert.equal(res.status, 404);
        });
    });

    describe('questions and answers', () => {
        it('accepts a question as pending and hides it until approved', async () => {
            const client = createClient(server.baseUrl);
            const res = await client.post('/api/questions', { teacher_id: teacherA, question: 'Does she curve the finals?' });
            assert.equal(res.status, 200);
            const list = await client.get('/api/questions');
            assert.equal(list.status, 200);
            assert.equal(list.body.questions.length, 0);
        });

        it('shows approved questions and only approved answers', async () => {
            const q = await dbQuery("INSERT INTO questions (teacher_id, question, is_approved) VALUES (?, 'Is attendance strict?', 1)", [teacherA]);
            await dbQuery("INSERT INTO question_answers (question_id, answer, is_approved) VALUES (?, 'Yes, 80% minimum.', 1)", [q.insertId]);
            await dbQuery("INSERT INTO question_answers (question_id, answer, is_approved) VALUES (?, 'Pending answer', 0)", [q.insertId]);

            const client = createClient(server.baseUrl);
            const list = await client.get('/api/questions');
            const question = list.body.questions.find((x) => x.id === q.insertId);
            assert.ok(question);
            assert.deepEqual(question.answers.map((a) => a.answer), ['Yes, 80% minimum.']);

            const answer = await client.post(`/api/questions/${q.insertId}/answers`, { answer: 'Also quizzes are weekly.' });
            assert.equal(answer.status, 200);
        });

        it('will not take answers on an unapproved question', async () => {
            const q = await dbQuery("INSERT INTO questions (teacher_id, question, is_approved) VALUES (?, 'Hidden question?', 0)", [teacherA]);
            const res = await createClient(server.baseUrl).post(`/api/questions/${q.insertId}/answers`, { answer: 'Hello' });
            assert.equal(res.status, 404);
        });
    });

    describe('SEO and errors', () => {
        it('serves robots.txt pointing at the sitemap', async () => {
            const res = await createClient(server.baseUrl).get('/robots.txt');
            assert.equal(res.status, 200);
            assert.match(res.text, /Disallow: \/admin/);
            assert.match(res.text, /Sitemap: http:\/\/localhost:3000\/sitemap\.xml/);
        });

        it('serves a sitemap with teacher and department URLs', async () => {
            const res = await createClient(server.baseUrl).get('/sitemap.xml');
            assert.equal(res.status, 200);
            assert.match(res.text, /<urlset/);
            assert.ok(res.text.includes(`/teacher/${teacherA}`));
            assert.ok(res.text.includes('/department/'));
            // Courses come from the JSON array in approved reviews only.
            assert.ok(res.text.includes('/course/Calculus%20I'), 'approved course listed');
            assert.ok(!res.text.includes('Marketing'), 'course from a pending review not listed');
        });

        it('answers unknown routes with JSON 404', async () => {
            const res = await createClient(server.baseUrl).get('/api/does-not-exist');
            assert.equal(res.status, 404);
            assert.deepEqual(res.body, { error: 'Not found' });
        });

        it('answers malformed JSON with 400, not a stack trace', async () => {
            const res = await createClient(server.baseUrl).request('POST', '/api/reviews', { raw: '{"teacher_id": ' });
            assert.equal(res.status, 400);
            assert.deepEqual(res.body, { error: 'Request body is not valid JSON' });
        });

        it('sends security headers', async () => {
            const res = await createClient(server.baseUrl).get('/api/health');
            assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
            assert.ok(res.headers.get('content-security-policy'));
        });
    });

    describe('CORS', () => {
        it('allows credentials only for the configured frontend origin', async () => {
            const client = createClient(server.baseUrl);
            const own = await client.get('/api/health', { headers: { Origin: 'http://localhost:3000' } });
            assert.equal(own.headers.get('access-control-allow-origin'), 'http://localhost:3000');
            assert.equal(own.headers.get('access-control-allow-credentials'), 'true');

            const preview = await client.get('/api/health', { headers: { Origin: 'https://some-branch.vercel.app' } });
            assert.equal(preview.headers.get('access-control-allow-origin'), 'https://some-branch.vercel.app');
            assert.equal(preview.headers.get('access-control-allow-credentials'), null);

            const evil = await client.get('/api/health', { headers: { Origin: 'https://evil.example' } });
            assert.equal(evil.headers.get('access-control-allow-origin'), null);
        });
    });
});
