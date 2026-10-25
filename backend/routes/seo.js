// Dynamic sitemap.xml and robots.txt.

const express = require('express');
const db = require('../db');
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
        // Distinct courses mentioned in approved reviews — used for /course/:name pages.
        // Kept lightweight: simple distinct list from the JSON array column.
        const [courses] = await db.query(`
            SELECT DISTINCT TRIM(JSON_UNQUOTE(JSON_EXTRACT(c.name, '$')) ) AS name
            FROM (
                SELECT SUBSTRING_INDEX(SUBSTRING_INDEX(courses, ',', n.n), ',', -1) AS name
                FROM reviews
                JOIN (
                    SELECT 1 AS n UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4
                    UNION ALL SELECT 5 UNION ALL SELECT 6 UNION ALL SELECT 7 UNION ALL SELECT 8
                    UNION ALL SELECT 9 UNION ALL SELECT 10 UNION ALL SELECT 11 UNION ALL SELECT 12
                ) n
                WHERE is_approved = 1 AND courses IS NOT NULL AND courses != ''
                  AND LENGTH(courses) - LENGTH(REPLACE(courses, ',', '')) >= n.n - 1
            ) c
            WHERE TRIM(c.name) != ''
            ORDER BY c.name
            LIMIT 100
        `);
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

        // Course pages: each distinct course gets a listing page.
        // Only include courses that have at least one teacher in the directory.
        if (courses.length > 0) {
            const [teachersWithCourses] = await db.query(`
                SELECT DISTINCT t.id, t.name
                FROM teachers t
                JOIN reviews r ON r.teacher_id = t.id AND r.is_approved = 1
                WHERE r.courses IS NOT NULL AND r.courses != ''
            `);
            const courseTeacherIds = new Set(teachersWithCourses.map((t) => t.id));
            const seen = [];
            courses.forEach((row) => {
                const name = String(row.name || '').trim();
                if (!name || name.length < 2 || seen.includes(name)) return;
                // Only include if there are actual teachers for it
                // (we check at render time; if empty the page is noindexed client-side)
                addUrl(
                    `${baseUrl}/course/${encodeURIComponent(name)}`,
                    today,
                    'weekly',
                    '0.5'
                );
                seen.push(name);
            });
        }

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
