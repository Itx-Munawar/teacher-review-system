// Link previews for chat apps and the boot-time tidy-up of teacher rows.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { SKIP, resetDatabase, dbQuery, startServer, createClient, createAdminAndLogin } = require('../testing/apiHarness');

const ogContent = (html, property) => {
    const match = new RegExp(`<meta (?:property|name)="${property}" content="([^"]*)"`).exec(html);
    return match ? match[1] : null;
};

describe('link previews and teacher tidy-up', { skip: SKIP }, () => {
    let server;
    let withPhoto;
    let noPhoto;
    let messy;
    let shortDept;

    before(async () => {
        await resetDatabase();
        withPhoto = (await dbQuery(
            "INSERT INTO teachers (name, department, image_url) VALUES ('Sania <Qamar>', 'School of Systems and Technology', 'https://admin.umt.edu.pk/Media/UserProfile/123.jpg')"
        )).insertId;
        noPhoto = (await dbQuery(
            "INSERT INTO teachers (name, department, image_url) VALUES ('Umer Usman', 'School of Science', 'https://admin.umt.edu.pk/Media/UserProfile/')"
        )).insertId;
        messy = (await dbQuery("INSERT INTO teachers (name, department) VALUES ('  Dr  Nosheen   Qamar ', 'School of  Systems and Technology')")).insertId;
        shortDept = (await dbQuery("INSERT INTO teachers (name, department) VALUES ('Ms Tahira', 'SST')")).insertId;
        await dbQuery("INSERT INTO teachers (name, department) VALUES ('Odd One', 'No idea')");
        const reviews = [
            [withPhoto, 'Great teacher, clear lectures.', ['Data Structures'], 1],
            [withPhoto, 'Fair grading and helpful.', ['Data Structures', 'OOP'], 1],
            [withPhoto, 'Still waiting for moderation.', ['Secret Course'], 0],
        ];
        for (const [teacherId, comment, courses, approved] of reviews) {
            await dbQuery(
                'INSERT INTO reviews (teacher_id, comment, courses, is_approved) VALUES (?, ?, ?, ?)',
                [teacherId, comment, JSON.stringify(courses), approved]
            );
        }
        server = await startServer();
    });

    after(async () => {
        if (server) await server.stop();
    });

    describe('teacher preview page', () => {
        it('describes the teacher with photo, review count and courses', async () => {
            const res = await createClient(server.baseUrl).get(`/seo/teacher/${withPhoto}`, { headers: { 'User-Agent': 'WhatsApp/2.24.1 A' } });
            assert.equal(res.status, 200);
            assert.match(res.headers.get('content-type'), /text\/html/);
            assert.match(res.headers.get('cache-control'), /private/);
            assert.equal(ogContent(res.text, 'og:title'), 'Sania &lt;Qamar&gt; - School of Systems and Technology | UMT Teacher Reviews');
            const description = ogContent(res.text, 'og:description');
            assert.match(description, /^2 anonymous student reviews\. Courses: Data Structures, OOP\./);
            assert.doesNotMatch(res.text, /Secret Course/);
            assert.equal(ogContent(res.text, 'og:image'), 'https://admin.umt.edu.pk/Media/UserProfile/123.jpg');
            assert.match(ogContent(res.text, 'og:url'), new RegExp(`/teacher/${withPhoto}$`));
            assert.doesNotMatch(res.text, /<script/i);
        });

        it('puts the saved AI summary first, without calling the AI', async () => {
            const overview = 'Zyada tar students kehte hain ke lectures clear hain aur grading fair hai, lekin kuch students ko assignments zyada lagte hain aur deadlines strict hain jo mushkil hai, phir bhi zyada tar log inhein recommend karte hain kyunke concepts pakke ho jaate hain.';
            await dbQuery(
                'INSERT INTO teacher_summaries (teacher_id, summary, signature, review_count) VALUES (?, ?, ?, 2)',
                [withPhoto, JSON.stringify({ overview, pros: ['Lectures clear'], cons: [] }), 'n:1']
            );
            const res = await createClient(server.baseUrl).get(`/seo/teacher/${withPhoto}`, { headers: { 'User-Agent': 'WhatsApp/2.24.1 A' } });
            const description = ogContent(res.text, 'og:description');
            assert.match(description, /^AI summary: Zyada tar students kehte hain ke lectures clear hain/);
            assert.match(description, /\.\.\. \| 2 anonymous student reviews\. Courses: Data Structures, OOP\.$/, 'long overviews are cut at a word');
            assert.ok(description.length < 300, `short enough for a preview (${description.length})`);
            await dbQuery('DELETE FROM teacher_summaries WHERE teacher_id = ?', [withPhoto]);
        });

        it('falls back to the site logo and invites the first review', async () => {
            const res = await createClient(server.baseUrl).get(`/seo/teacher/${noPhoto}`);
            assert.equal(res.status, 200);
            assert.match(ogContent(res.text, 'og:image'), /\/logo512\.png$/);
            assert.match(ogContent(res.text, 'og:description'), /^No reviews yet\. Be the first/);
        });

        it('answers unknown or invalid ids with the generic page', async () => {
            for (const id of ['999999', 'abc', '0', '1e3']) {
                const res = await createClient(server.baseUrl).get(`/seo/teacher/${id}`);
                assert.equal(res.status, 404, id);
                assert.match(ogContent(res.text, 'og:title'), /^UMT Teacher Reviews/);
            }
        });
    });

    describe('teacher tidy-up', () => {
        const rowFor = async (id) => (await dbQuery('SELECT name, department FROM teachers WHERE id = ?', [id]))[0];

        it('collapses stray spaces and expands a school short form on boot', async () => {
            // The sweep runs right after the schema bootstrap; give it a moment.
            let row;
            for (let i = 0; i < 50; i += 1) {
                row = await rowFor(shortDept);
                if (row.department !== 'SST') break;
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
            assert.equal(row.department, 'School of Systems and Technology');
            assert.deepEqual({ ...(await rowFor(messy)) }, { name: 'Dr Nosheen Qamar', department: 'School of Systems and Technology' });
            const [odd] = await dbQuery("SELECT department FROM teachers WHERE name = 'Odd One'");
            assert.equal(odd.department, 'No idea', 'unclear departments are left for a human');
            const [log] = await dbQuery("SELECT details FROM audit_logs WHERE action = 'TIDY_TEACHERS'");
            assert.match(log.details, /SST/);
        });

        it('normalises what an admin types', async () => {
            const admin = await createAdminAndLogin(server.baseUrl);
            const created = await admin.post('/api/admin/teachers', { name: '  Hareem   Aslam ', department: 'SST' });
            assert.equal(created.status, 200, created.text);
            assert.deepEqual({ ...(await rowFor(created.body.id)) }, { name: 'Hareem Aslam', department: 'School of Systems and Technology' });

            // An unknown abbreviation is kept as typed rather than guessed.
            const unknown = await admin.post('/api/admin/teachers', { name: 'Waqar Ashiq', department: 'XYZ' });
            assert.equal((await rowFor(unknown.body.id)).department, 'XYZ');

            const blank = await admin.post('/api/admin/teachers', { name: '   ', department: 'School of Science' });
            assert.equal(blank.status, 400);
        });
    });
});
