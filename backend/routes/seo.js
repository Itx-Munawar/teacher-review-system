// Dynamic sitemap.xml and robots.txt.

const express = require('express');
const db = require('../db');
const { parseCourseList } = require('../contentFilter');
const { PUBLIC_SITE_URL } = require('../config');
const state = require('../state');

const router = express.Router();

// ========== DYNAMIC SITEMAP.XML ==========
router.get('/sitemap.xml', async (req, res) => {
    try {
        // Real last-modified dates matter: stamping every URL with "today" on
        // every request teaches crawlers to ignore the field entirely.
        const [teachers] = await db.query(`
            SELECT t.id, t.created_at,
                   (SELECT MAX(r.created_at) FROM reviews r
                     WHERE r.teacher_id = t.id AND r.is_approved = 1) AS last_review
            FROM teachers t
            ORDER BY t.name
        `);
        const [departments] = await db.query(`
            SELECT department, MAX(created_at) AS last_added
            FROM teachers
            GROUP BY department
            ORDER BY department
        `);
        const [questionMeta] = await db.query(
            'SELECT MAX(created_at) AS last_question FROM questions WHERE is_approved = 1'
        );
        // Courses mentioned in approved reviews, for the /course/:name pages.
        // reviews.courses holds a JSON array (older rows: plain text), so it is
        // parsed here rather than in SQL. The previous SQL split the JSON on
        // commas and fed the fragments to JSON_EXTRACT, which MySQL 8 rejects as
        // invalid JSON - that error took the whole sitemap down with a 500.
        const [courseRows] = await db.query(
            "SELECT courses FROM reviews WHERE is_approved = 1 AND courses IS NOT NULL AND courses != ''"
        );
        const courseCounts = new Map(); // lower-cased name -> { name, count }
        courseRows.forEach((row) => {
            parseCourseList(row.courses).forEach((raw) => {
                const name = raw.replace(/\s+/g, ' ').trim();
                if (name.length < 2 || name.length > 200) return;
                const key = name.toLowerCase();
                const entry = courseCounts.get(key);
                if (entry) entry.count += 1;
                else courseCounts.set(key, { name, count: 1 });
            });
        });
        // Most-reviewed courses first; cap keeps the sitemap focused.
        const courses = [...courseCounts.values()]
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, 100);
        const baseUrl = PUBLIC_SITE_URL;

        const asDate = (value) => {
            if (!value) return null;
            const date = value instanceof Date ? value : new Date(value);
            return Number.isNaN(date.getTime()) ? null : date.toISOString().split('T')[0];
        };
        const today = asDate(new Date());

        let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
        xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

        const addUrl = (loc, lastmod, changefreq, priority) => {
            xml += `  <url>\n    <loc>${loc}</loc>\n`;
            if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
            xml += `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>\n`;
        };

        // Homepage
        addUrl(`${baseUrl}/`, today, 'daily', '1.0');

        // Static pages. /about has no route (it redirects to the homepage), so it
        // is intentionally absent. Legal pages have no real modification date.
        ['privacy', 'terms', 'dmca', 'contact'].forEach((page) => {
            addUrl(`${baseUrl}/${page}`, null, 'yearly', '0.3');
        });

        // Public Q&A board
        if (questionMeta[0]?.last_question) {
            addUrl(`${baseUrl}/questions`, asDate(questionMeta[0].last_question), 'daily', '0.6');
        }

        // Department pages
        departments.forEach((dept) => {
            addUrl(
                `${baseUrl}/department/${encodeURIComponent(dept.department)}`,
                asDate(dept.last_added),
                'weekly',
                '0.7'
            );
        });

        // Teacher pages: last approved review, or the row's creation date.
        teachers.forEach((teacher) => {
            addUrl(
                `${baseUrl}/teacher/${teacher.id}`,
                asDate(teacher.last_review || teacher.created_at),
                'weekly',
                '0.8'
            );
        });

        // Course pages: each distinct course gets a listing page (the page
        // itself noindexes when no teacher matches).
        courses.forEach(({ name }) => {
            addUrl(`${baseUrl}/course/${encodeURIComponent(name)}`, today, 'weekly', '0.5');
        });

        xml += '</urlset>';

        res.set('Content-Type', 'application/xml');
        res.send(xml);
    } catch (error) {
        console.error('Error generating sitemap:', error);
        res.status(500).send('Error generating sitemap');
    }
});

// ========== LINK PREVIEWS FOR CHAT APPS ==========
// WhatsApp, Facebook, Telegram, Discord etc. do not run JavaScript, so they
// only ever saw the generic homepage tags from index.html. Vercel sends their
// crawlers (matched by user-agent in vercel.json) here instead, and this
// answers a tiny HTML page whose Open Graph tags describe the actual teacher.
// Real visitors never reach this route: they get the SPA as before.

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Same rule as the frontend's isUsableImageUrl: an absolute http(s) URL that
// ends in an image file name (the data has a few bare directory URLs).
const usableImage = (url) => {
    const trimmed = String(url || '').trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
        const { pathname } = new URL(trimmed);
        const file = pathname.split('/').filter(Boolean).pop() || '';
        return /\.(jpe?g|png|webp|gif)$/i.test(file) ? trimmed.replace(/^http:/i, 'https:') : null;
    } catch (err) {
        return null;
    }
};

/** First sentence-ish of a saved AI summary, cut at a word boundary. */
const clipSentence = (text, max = 200) => {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max);
    return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max - 30)).replace(/[\s,;:.-]+$/, '')}...`;
};

/** The saved AI summary overview, if one exists. Never calls the AI. */
const savedSummaryLine = async (teacherId) => {
    if (!state.teacherSummariesReady) return '';
    try {
        const [rows] = await db.query('SELECT summary FROM teacher_summaries WHERE teacher_id = ?', [teacherId]);
        if (!rows.length) return '';
        return clipSentence(JSON.parse(rows[0].summary).overview);
    } catch (_) {
        return '';
    }
};

const previewPage = ({ title, description, url, image, imageAlt, card = 'summary' }) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(url)}">
<meta property="og:type" content="profile">
<meta property="og:site_name" content="UMT Teacher Reviews">
<meta property="og:url" content="${escapeHtml(url)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:alt" content="${escapeHtml(imageAlt)}">
<meta name="twitter:card" content="${card}">
<meta name="twitter:title" content="${escapeHtml(title)}">
<meta name="twitter:description" content="${escapeHtml(description)}">
<meta name="twitter:image" content="${escapeHtml(image)}">
</head>
<body>
<h1>${escapeHtml(title)}</h1>
<p>${escapeHtml(description)}</p>
<p><a href="${escapeHtml(url)}">Open on UMT Teacher Reviews</a></p>
</body>
</html>
`;

const sendPreview = (res, status, page) => {
    res.status(status);
    res.set('Content-Type', 'text/html; charset=utf-8');
    // "private" keeps Vercel's CDN from caching this crawler-only page and
    // handing it to a real visitor of the same URL.
    res.set('Cache-Control', 'private, max-age=600');
    res.set('Vary', 'User-Agent');
    res.set('X-Robots-Tag', 'noindex');
    res.send(page);
};

router.get('/seo/teacher/:id', async (req, res) => {
    const baseUrl = PUBLIC_SITE_URL;
    const fallback = {
        title: 'UMT Teacher Reviews – Anonymous Reviews for UMT Professors',
        description: 'Read and write anonymous reviews for UMT teachers. Find the best professors at University of Management and Technology, Lahore.',
        url: `${baseUrl}/`,
        image: `${baseUrl}/logo512.png`,
        imageAlt: 'UMT Teacher Reviews',
    };
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1 || id > 4294967295) {
        return sendPreview(res, 404, previewPage(fallback));
    }
    try {
        const [rows] = await db.query('SELECT id, name, department, image_url FROM teachers WHERE id = ?', [id]);
        if (!rows.length) return sendPreview(res, 404, previewPage(fallback));
        const teacher = rows[0];
        const [reviews] = await db.query(
            'SELECT courses FROM reviews WHERE teacher_id = ? AND is_approved = 1',
            [id]
        );

        // Most-mentioned courses, so the preview says what they teach.
        const courseCounts = new Map();
        reviews.forEach((row) => {
            parseCourseList(row.courses).forEach((raw) => {
                const name = String(raw).replace(/\s+/g, ' ').trim();
                if (name.length < 2 || name.length > 80) return;
                const key = name.toLowerCase();
                const entry = courseCounts.get(key) || { name, count: 0 };
                entry.count += 1;
                courseCounts.set(key, entry);
            });
        });
        const topCourses = [...courseCounts.values()]
            .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
            .slice(0, 3)
            .map((c) => c.name);

        const count = reviews.length;
        const name = String(teacher.name).replace(/\s+/g, ' ').trim();
        const department = String(teacher.department).replace(/\s+/g, ' ').trim();
        const summary = count === 0
            ? 'No reviews yet. Be the first to share an anonymous review.'
            : `${count} anonymous student review${count === 1 ? '' : 's'}.`;
        const courses = topCourses.length ? ` Courses: ${topCourses.join(', ')}.` : '';
        const image = usableImage(teacher.image_url);
        // The saved AI summary makes the WhatsApp preview say what students
        // actually think. It is only read here - a preview never spends AI quota.
        const aiLine = count > 0 ? await savedSummaryLine(teacher.id) : '';
        const description = aiLine
            ? `AI summary: ${aiLine} | ${summary}${courses}`
            : `${summary}${courses} See what UMT students say about grading, attendance and teaching.`;

        sendPreview(res, 200, previewPage({
            title: `${name} - ${department} | UMT Teacher Reviews`,
            description,
            url: `${baseUrl}/teacher/${teacher.id}`,
            image: image || fallback.image,
            imageAlt: image ? `Photo of ${name}` : fallback.imageAlt,
        }));
    } catch (error) {
        console.error('Error building teacher preview:', error);
        sendPreview(res, 500, previewPage(fallback));
    }
});

// ========== DYNAMIC ROBOTS.TXT ==========
router.get('/robots.txt', (req, res) => {
    const baseUrl = PUBLIC_SITE_URL;
    const robots = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/

Sitemap: ${baseUrl}/sitemap.xml
`;
    res.set('Content-Type', 'text/plain');
    res.send(robots);
});

module.exports = router;
