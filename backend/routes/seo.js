// Dynamic sitemap.xml and robots.txt.

const express = require('express');
const db = require('../db');
const { parseCourseList } = require('../contentFilter');
const { PUBLIC_SITE_URL } = require('../config');

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
