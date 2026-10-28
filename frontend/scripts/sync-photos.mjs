#!/usr/bin/env node
// Downloads every teacher photo once, resized to small WebP files, into
// public/photos so the site serves them itself instead of hotlinking UMT's
// slow server (3-7 s per photo, sometimes it hangs) or wsrv.nl (blocked on
// some Pakistani networks).
//
//   node scripts/sync-photos.mjs            # add new photos, drop unused ones
//   API_BASE=https://... node scripts/sync-photos.mjs
//
// Two sizes per photo:
//   public/photos/s/<file>.webp  160 px - list cards, search, compare (<= 80 px circles at 2x)
//   public/photos/l/<file>.webp  320 px - teacher page hero (130 px at 2x)
// Re-running only downloads what is missing. The frontend falls back to the
// proxied/original photo for anything not here yet (a newly added teacher).

import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_BASE = (process.env.API_BASE || 'https://teacher-review-system.onrender.com').replace(/\/$/, '');
const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'photos');
const SIZES = { s: 160, l: 320 };
const CONCURRENCY = 6;
// Same rule as src/utils/imageThumb.ts.
const UMT_PROFILE_PHOTO = /^https?:\/\/admin\.umt\.edu\.pk\/Media\/UserProfile\/([A-Za-z0-9_-]+)\.(?:jpe?g|png|webp|gif|avif)$/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 4) {
    for (let i = 1; ; i += 1) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            if (i >= tries) throw err;
            await sleep(2000 * i); // the free Render instance may be waking up
        }
    }
}

async function listTeachers() {
    const all = [];
    for (let page = 1; page < 100; page += 1) {
        const data = await fetchJson(`${API_BASE}/api/teachers?limit=100&page=${page}`);
        const rows = Array.isArray(data) ? data : (data.teachers || []);
        all.push(...rows);
        if (rows.length < 100) break;
    }
    return all;
}

async function exists(file) {
    try { return (await stat(file)).size > 0; } catch { return false; }
}

async function download(originalUrl, width, file) {
    const params = new URLSearchParams({
        url: originalUrl, w: String(width), h: String(width), fit: 'cover', a: 'attention', output: 'webp', q: '72',
    });
    for (let i = 1; i <= 3; i += 1) {
        try {
            const res = await fetch(`https://wsrv.nl/?${params}`, { signal: AbortSignal.timeout(45000) });
            const type = res.headers.get('content-type') || '';
            if (!res.ok || !type.startsWith('image/')) throw new Error(`HTTP ${res.status} ${type}`);
            const body = Buffer.from(await res.arrayBuffer());
            if (body.length < 200) throw new Error('suspiciously small');
            await writeFile(file, body);
            return body.length;
        } catch (err) {
            if (i === 3) throw err;
            await sleep(1500 * i);
        }
    }
    return 0;
}

async function main() {
    const teachers = await listTeachers();
    const photos = new Map(); // file base -> original URL
    for (const t of teachers) {
        const url = String(t.image_url || '').trim();
        const m = url.match(UMT_PROFILE_PHOTO);
        if (m) photos.set(m[1], url.replace(/^http:/i, 'https:'));
    }
    console.log(`${teachers.length} teachers, ${photos.size} with a UMT photo`);

    for (const dir of Object.keys(SIZES)) await mkdir(path.join(OUT_DIR, dir), { recursive: true });

    const jobs = [];
    for (const [base, url] of photos) {
        for (const [dir, width] of Object.entries(SIZES)) {
            const file = path.join(OUT_DIR, dir, `${base}.webp`);
            if (!(await exists(file))) jobs.push({ base, url, width, file });
        }
    }
    console.log(`${jobs.length} files to download`);

    let done = 0;
    let bytes = 0;
    const failed = [];
    const worker = async () => {
        while (jobs.length) {
            const job = jobs.shift();
            try {
                const size = await download(job.url, job.width, job.file);
                bytes += size;
            } catch (err) {
                failed.push(`${job.base} (${job.width}px): ${err.message}`);
            }
            done += 1;
            if (done % 100 === 0) console.log(`  ${done} done`);
        }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    // Photos no teacher uses any more (changed or removed) are deleted.
    let removed = 0;
    for (const dir of Object.keys(SIZES)) {
        for (const name of await readdir(path.join(OUT_DIR, dir))) {
            if (name.endsWith('.webp') && !photos.has(name.slice(0, -5))) {
                await unlink(path.join(OUT_DIR, dir, name));
                removed += 1;
            }
        }
    }

    console.log(`downloaded ${done - failed.length} files (${Math.round(bytes / 1024)} KB), removed ${removed}, failed ${failed.length}`);
    failed.slice(0, 20).forEach((f) => console.log(`  failed: ${f}`));
    // A few failures (UMT hiccups) are fine: the site falls back for those.
    if (photos.size > 0 && failed.length > photos.size) process.exitCode = 1;
}

main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
});
