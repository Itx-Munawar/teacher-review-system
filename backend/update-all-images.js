const fs = require('fs');
const cheerio = require('cheerio');
const axios = require('axios');
const db = require('./db');

const DELAY_MS = 500;
const PLACEHOLDER_URL = 'https://via.placeholder.com/80/667eea/ffffff?text=Teacher';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTeacherImageFromProfile(profileUrl) {
    try {
        const response = await axios.get(profileUrl, { timeout: 10000 });
        const $ = cheerio.load(response.data);
        let imageUrl = null;

        $('img').each((i, img) => {
            const src = $(img).attr('src');
            if (src && src.includes('/Media/UserProfile/')) {
                imageUrl = src;
                return false;
            }
        });

        if (imageUrl && !imageUrl.startsWith('http')) {
            if (imageUrl.startsWith('/')) {
                imageUrl = 'https://admin.umt.edu.pk' + imageUrl;
            } else {
                imageUrl = profileUrl.replace(/\/[^/]*$/, '/') + imageUrl;
            }
        }
        return imageUrl;
    } catch (error) {
        console.error(`  ⚠️ Failed to fetch ${profileUrl}: ${error.message}`);
        return null;
    }
}

async function updateAllImages() {
    const html = fs.readFileSync('faculty.aspx', 'utf8');
    const $ = cheerio.load(html);

    const teachers = [];
    $('tr').each((i, row) => {
        const nameCell = $(row).find('td.person-name');
        const name = nameCell.find('a').text().trim();
        const profileUrl = nameCell.find('a').attr('href');
        if (name && profileUrl) {
            let absoluteUrl = profileUrl;
            if (!absoluteUrl.startsWith('http')) {
                absoluteUrl = 'https://www.umt.edu.pk' + (absoluteUrl.startsWith('/') ? '' : '/') + absoluteUrl;
            }
            teachers.push({ name, profileUrl: absoluteUrl });
        }
    });

    console.log(`✅ Found ${teachers.length} teachers with profile links.\n`);

    let updated = 0;
    let notFound = 0;
    let skipped = 0;

    for (let i = 0; i < teachers.length; i++) {
        const t = teachers[i];
        process.stdout.write(`[${i+1}/${teachers.length}] ${t.name}... `);

        // Check if teacher exists AND has either NULL, empty, OR the placeholder image
        const [rows] = await db.query(
            `SELECT id, image_url FROM teachers 
             WHERE name = ? 
             AND (image_url IS NULL OR image_url = '' OR image_url = ?)`,
            [t.name, PLACEHOLDER_URL]
        );
        if (rows.length === 0) {
            console.log('⏭️ not in DB or already has a real image.');
            skipped++;
            await sleep(DELAY_MS);
            continue;
        }

        const imageUrl = await getTeacherImageFromProfile(t.profileUrl);
        if (imageUrl) {
            await db.query('UPDATE teachers SET image_url = ? WHERE id = ?', [imageUrl, rows[0].id]);
            console.log('✅ image saved.');
            updated++;
        } else {
            console.log('❌ no image found.');
            notFound++;
        }

        await sleep(DELAY_MS);
    }

    console.log(`\n📊 SUMMARY:
        - Images updated: ${updated}
        - No image found on profile: ${notFound}
        - Skipped: ${skipped}
    `);
    process.exit(0);
}

updateAllImages();