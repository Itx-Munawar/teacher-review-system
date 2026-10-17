// Compare UMT's public faculty page with the `teachers` table.
//
//   node sync-faculty.js                      report only (fetches the live page)
//   node sync-faculty.js --file faculty.aspx  use a saved copy of the page instead
//   node sync-faculty.js --out report.json    also write the full report as JSON
//   node sync-faculty.js --apply              also INSERT the safe missing teachers
//
// Read-only unless --apply is passed, and even then it only inserts. It never
// updates or deletes rows (deleting a teacher also deletes their reviews).
//
// A teacher is identified by (name, department), compared case-insensitively
// with whitespace collapsed. The old importer matched on name alone, which
// silently dropped people who share a name across departments.

const fs = require('fs');

const FACULTY_URL = 'https://www.umt.edu.pk/faculty.aspx';
// Rows grouped under these headings are not real departments.
const IGNORE_DEPARTMENTS = new Set(['journals']);
// If fewer rows than this parse out of the page, it is almost certainly a
// block/challenge page and a diff against it would be meaningless.
const MIN_PLAUSIBLE_ROWS = 200;

const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const norm = (s) => clean(s).toLowerCase();
const pairKey = (name, dept) => `${norm(name)}|${norm(dept)}`;

function parseFaculty(html) {
    const cheerio = require('cheerio');
    const $ = cheerio.load(html);
    const rows = [];
    $('tr').each((_, row) => {
        const name = clean($(row).find('td.person-name a').first().text());
        const department = clean($(row).find('td.Person-School').first().text());
        if (name && department) rows.push({ name: name.slice(0, 100), department: department.slice(0, 100) });
    });
    return rows;
}

// Pure function: no I/O, so it can be tested without a database.
function plan(pageRows, dbRows) {
    const page = new Map(); // key -> { name, department, count }
    const pageDeptsByName = new Map(); // norm(name) -> Set(norm(dept))
    for (const r of pageRows) {
        const k = pairKey(r.name, r.department);
        if (!page.has(k)) page.set(k, { name: r.name, department: r.department, count: 0 });
        page.get(k).count++;
        const n = norm(r.name);
        if (!pageDeptsByName.has(n)) pageDeptsByName.set(n, new Set());
        pageDeptsByName.get(n).add(norm(r.department));
    }

    const db = new Map(); // key -> row
    const dbDeptsByName = new Map(); // norm(name) -> Set(norm(dept))
    for (const r of dbRows) {
        db.set(pairKey(r.name, r.department), r);
        const n = norm(r.name);
        if (!dbDeptsByName.has(n)) dbDeptsByName.set(n, new Set());
        dbDeptsByName.get(n).add(norm(r.department));
    }
    const knownDepartments = new Set(dbRows.map((r) => norm(r.department)));

    const missing = []; // safe to insert
    const possibleMoves = []; // same name in DB under another department: review by hand
    const ignored = [];
    for (const [k, p] of page) {
        if (db.has(k)) continue;
        if (IGNORE_DEPARTMENTS.has(norm(p.department))) { ignored.push(p); continue; }
        const n = norm(p.name);
        const dbDepts = dbDeptsByName.get(n);
        const pageDepts = pageDeptsByName.get(n);
        const stale = dbDepts ? [...dbDepts].filter((d) => !pageDepts.has(d)) : [];
        if (stale.length > 0) {
            possibleMoves.push({ name: p.name, pageDepartment: p.department, dbDepartments: stale });
        } else {
            missing.push({ name: p.name, department: p.department });
        }
    }

    const notOnPage = dbRows
        .filter((r) => !page.has(pairKey(r.name, r.department)))
        .map((r) => ({ id: r.id, name: r.name, department: r.department }));
    const repeatedOnPage = [...page.values()].filter((p) => p.count > 1).map((p) => ({ name: p.name, department: p.department, times: p.count }));
    const newDepartments = [...new Set(missing.map((m) => m.department).filter((d) => !knownDepartments.has(norm(d))))];

    return {
        pageRows: pageRows.length,
        pageDistinct: page.size,
        dbRows: dbRows.length,
        missing,
        possibleMoves,
        notOnPage,
        repeatedOnPage,
        newDepartments,
        ignored,
    };
}

async function loadPage(args) {
    const fileIdx = args.indexOf('--file');
    if (fileIdx !== -1) return fs.readFileSync(args[fileIdx + 1], 'utf8');
    const axios = require('axios');
    const res = await axios.get(FACULTY_URL, {
        timeout: 30000,
        responseType: 'text',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; teacher-review-sync)' },
    });
    return res.data;
}

const list = (title, items, fmt, limit = 400) => {
    console.log(`\n${title} (${items.length})`);
    items.slice(0, limit).forEach((i) => console.log('  ' + fmt(i)));
    if (items.length > limit) console.log(`  ... and ${items.length - limit} more (use --out to get the full list)`);
};

async function main() {
    const args = process.argv.slice(2);
    const apply = args.includes('--apply');
    const outIdx = args.indexOf('--out');

    const html = await loadPage(args);
    const pageRows = parseFaculty(html);
    if (pageRows.length < MIN_PLAUSIBLE_ROWS) {
        console.error(`Only ${pageRows.length} faculty rows parsed from the page (expected 1000+). ` +
            'It was probably blocked or changed layout. Save the page from your browser and pass it with --file.');
        process.exit(1);
    }

    const db = require('./db');
    const [dbRows] = await db.query('SELECT id, name, department FROM teachers');
    const result = plan(pageRows, dbRows);

    console.log(`Faculty page: ${result.pageRows} rows (${result.pageDistinct} distinct name+department)`);
    console.log(`Your site:    ${result.dbRows} teachers`);
    list('MISSING from your site (safe to add)', result.missing, (m) => `${m.name} | ${m.department}`);
    list('POSSIBLE MOVES - same name on your site under a different department (fix by hand in the admin panel)',
        result.possibleMoves, (m) => `${m.name} | page: ${m.pageDepartment} | site: ${m.dbDepartments.join(', ')}`);
    list('On your site but NOT on the page (left UMT, renamed, or added by hand; never auto-removed)',
        result.notOnPage, (m) => `#${m.id} ${m.name} | ${m.department}`);
    list('Listed more than once on the page (treated as one person; check if they are really two)',
        result.repeatedOnPage, (m) => `${m.name} | ${m.department} x${m.times}`);
    if (result.newDepartments.length) console.log(`\nNew departments that would appear: ${result.newDepartments.join('; ')}`);

    if (outIdx !== -1) {
        fs.writeFileSync(args[outIdx + 1], JSON.stringify(result, null, 2));
        console.log(`\nFull report written to ${args[outIdx + 1]}`);
    }

    if (!apply) {
        console.log(`\nDry run: nothing was changed. Re-run with --apply to insert the ${result.missing.length} missing teachers.`);
    } else if (result.missing.length === 0) {
        console.log('\nNothing to insert.');
    } else {
        await db.query('INSERT INTO teachers (name, department, image_url) VALUES ?',
            [result.missing.map((m) => [m.name, m.department, null])]);
        console.log(`\nInserted ${result.missing.length} teachers (no photos; the site shows initials until one is added).`);
        console.log('They appear on the site within about a minute (server cache).');
    }
    process.exit(0);
}

module.exports = { parseFaculty, plan, pairKey };

if (require.main === module) {
    main().catch((err) => {
        console.error('Sync failed:', err.message);
        process.exit(1);
    });
}
