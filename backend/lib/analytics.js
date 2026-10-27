// Anonymous usage counters for the admin Analytics tab. Only daily totals are
// stored (visits, profile views per teacher, search terms) - never an IP, a
// cookie id or anything else that points at a person.

const db = require('../db');
const state = require('../state');
const { logJson } = require('./log');

const RETENTION_DAYS = 400;
// Days are counted in Pakistan time so "today" matches the students' day.
const PK_DAY = 'DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 HOUR))';

const BOT_UA = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|discord|curl|wget|python|axios|node-fetch|headless|lighthouse|pingdom|uptime|monitor/i;
const isBot = (userAgent) => !userAgent || BOT_UA.test(userAgent);

const swallow = (label) => (err) => logJson('warn', label, { reason: String(err && err.message) });

const trackVisit = async () => {
    if (!state.analyticsReady) return;
    await db.query(
        `INSERT INTO site_visits_daily (day, visits) VALUES (${PK_DAY}, 1)
         ON DUPLICATE KEY UPDATE visits = visits + 1`
    ).catch(swallow('analytics_visit_failed'));
};

const trackTeacherView = async (teacherId) => {
    if (!state.analyticsReady) return false;
    try {
        // INSERT ... SELECT so an unknown id simply inserts nothing.
        const [result] = await db.query(
            `INSERT INTO teacher_views_daily (day, teacher_id, views)
             SELECT ${PK_DAY}, id, 1 FROM teachers WHERE id = ?
             ON DUPLICATE KEY UPDATE views = views + 1`,
            [teacherId]
        );
        return result.affectedRows > 0;
    } catch (err) {
        swallow('analytics_view_failed')(err);
        return false;
    }
};

const normaliseTerm = (q) => String(q || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);

const trackSearch = async (query, resultCount) => {
    if (!state.analyticsReady) return;
    const term = normaliseTerm(query);
    if (term.length < 3) return;
    await db.query(
        `INSERT INTO search_terms_daily (day, term, searches, results) VALUES (${PK_DAY}, ?, 1, ?)
         ON DUPLICATE KEY UPDATE searches = searches + 1, results = VALUES(results)`,
        [term, Math.max(0, Number(resultCount) || 0)]
    ).catch(swallow('analytics_search_failed'));
};

const pruneAnalytics = async () => {
    if (!state.analyticsReady) return;
    for (const table of ['site_visits_daily', 'teacher_views_daily', 'search_terms_daily']) {
        await db.query(`DELETE FROM ${table} WHERE day < DATE_SUB(${PK_DAY}, INTERVAL ? DAY)`, [RETENTION_DAYS])
            .catch(swallow('analytics_prune_failed'));
    }
};

const safeCount = async (sql, params) => {
    try {
        const [rows] = await db.query(sql, params);
        return Number(rows[0] && rows[0].n) || 0;
    } catch (_) {
        return 0;
    }
};

/** Everything the Analytics tab shows for the last `days` days. */
const getAnalytics = async (days) => {
    const since = `DATE_SUB(${PK_DAY}, INTERVAL ${Number(days) - 1} DAY)`;
    const sinceTs = 'DATE_SUB(NOW(), INTERVAL ? DAY)';

    const [visitRows] = await db.query(`SELECT day, visits FROM site_visits_daily WHERE day >= ${since} ORDER BY day`);
    const [viewRows] = await db.query(`SELECT day, SUM(views) AS views FROM teacher_views_daily WHERE day >= ${since} GROUP BY day ORDER BY day`);
    const [reviewRows] = await db.query(
        `SELECT DATE(created_at) AS day, COUNT(*) AS reviews
         FROM reviews WHERE created_at >= ${sinceTs} GROUP BY DATE(created_at) ORDER BY DATE(created_at)`,
        [days]
    );

    const dayKey = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
    const byDay = new Map();
    const touch = (d) => {
        const k = dayKey(d);
        if (!byDay.has(k)) byDay.set(k, { day: k, visits: 0, teacher_views: 0, reviews: 0 });
        return byDay.get(k);
    };
    // Every day in the window appears, including quiet ones.
    const [[todayRow]] = await db.query(`SELECT ${PK_DAY} AS today`);
    const today = new Date(`${dayKey(todayRow.today)}T00:00:00Z`);
    for (let i = Number(days) - 1; i >= 0; i -= 1) {
        touch(new Date(today.getTime() - i * 86400000));
    }
    visitRows.forEach((r) => { touch(r.day).visits = Number(r.visits) || 0; });
    viewRows.forEach((r) => { touch(r.day).teacher_views = Number(r.views) || 0; });
    reviewRows.forEach((r) => { const k = dayKey(r.day); if (byDay.has(k)) byDay.get(k).reviews = Number(r.reviews) || 0; });
    const daily = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));

    const [topTeachers] = await db.query(
        `SELECT t.id, t.name, t.department, SUM(v.views) AS views,
                (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id = t.id AND r.is_approved = 1) AS reviews
         FROM teacher_views_daily v JOIN teachers t ON t.id = v.teacher_id
         WHERE v.day >= ${since}
         GROUP BY t.id, t.name, t.department
         ORDER BY views DESC, t.name
         LIMIT 15`
    );
    // Popular profiles with few reviews: where a "please review" push pays off.
    const [needsReviews] = await db.query(
        `SELECT * FROM (
            SELECT t.id, t.name, t.department, SUM(v.views) AS views,
                   (SELECT COUNT(*) FROM reviews r WHERE r.teacher_id = t.id AND r.is_approved = 1) AS reviews
            FROM teacher_views_daily v JOIN teachers t ON t.id = v.teacher_id
            WHERE v.day >= ${since}
            GROUP BY t.id, t.name, t.department
         ) x WHERE x.reviews < 3 ORDER BY x.views DESC, x.name LIMIT 10`
    );
    const [topSearches] = await db.query(
        `SELECT term, SUM(searches) AS searches, MIN(results) AS min_results
         FROM search_terms_daily WHERE day >= ${since}
         GROUP BY term ORDER BY searches DESC, term LIMIT 15`
    );
    const [departments] = await db.query(
        `SELECT t.department,
                COUNT(*) AS teachers,
                SUM(CASE WHEN rc.n > 0 THEN 1 ELSE 0 END) AS reviewed_teachers,
                COALESCE(SUM(rc.n), 0) AS reviews,
                COALESCE(SUM(vc.views), 0) AS views
         FROM teachers t
         LEFT JOIN (SELECT teacher_id, COUNT(*) AS n FROM reviews WHERE is_approved = 1 GROUP BY teacher_id) rc ON rc.teacher_id = t.id
         LEFT JOIN (SELECT teacher_id, SUM(views) AS views FROM teacher_views_daily WHERE day >= ${since} GROUP BY teacher_id) vc ON vc.teacher_id = t.id
         GROUP BY t.department
         ORDER BY teachers DESC`
    );

    const num = (rows, key) => rows.reduce((sum, r) => sum + (Number(r[key]) || 0), 0);
    const totals = {
        visits: num(daily, 'visits'),
        teacher_views: num(daily, 'teacher_views'),
        reviews_submitted: await safeCount(`SELECT COUNT(*) AS n FROM reviews WHERE created_at >= ${sinceTs}`, [days]),
        replies_submitted: state.reviewRepliesReady ? await safeCount(`SELECT COUNT(*) AS n FROM review_replies WHERE created_at >= ${sinceTs}`, [days]) : 0,
        helpful_votes: state.reviewVotesReady ? await safeCount(`SELECT COUNT(*) AS n FROM review_votes WHERE created_at >= ${sinceTs}`, [days]) : 0,
        questions_asked: await safeCount(`SELECT COUNT(*) AS n FROM questions WHERE created_at >= ${sinceTs}`, [days]),
    };

    const toNum = (rows, keys) => rows.map((r) => {
        const out = { ...r };
        keys.forEach((k) => { out[k] = Number(out[k]) || 0; });
        return out;
    });

    return {
        days: Number(days),
        totals,
        daily,
        top_teachers: toNum(topTeachers, ['views', 'reviews']),
        needs_reviews: toNum(needsReviews, ['views', 'reviews']),
        top_searches: toNum(topSearches, ['searches', 'min_results']),
        departments: toNum(departments, ['teachers', 'reviewed_teachers', 'reviews', 'views']),
    };
};

module.exports = {
    isBot,
    trackVisit,
    trackTeacherView,
    trackSearch,
    pruneAnalytics,
    getAnalytics,
};
