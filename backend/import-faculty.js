// const fs = require('fs');
// const cheerio = require('cheerio');
// const axios = require('axios');
// const db = require('./db');

// const BASE_URL = 'https://www.umt.edu.pk';
// const DELAY_MS = 300; // milliseconds between profile requests (to be respectful)

// // Helper to sleep
// const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// // Extract image URL from a teacher's profile page
// async function getTeacherImage(profileUrl) {
//     if (!profileUrl) return null;
//     try {
//         const response = await axios.get(profileUrl, { timeout: 10000 });
//         const $ = cheerio.load(response.data);

//         // Common selectors for faculty images
//         const selectors = [
//             '.faculty-detail img',
//             '.profile-picture img',
//             '.faculty-image img',
//             'img[src*="UserProfile"]',
//             '.person-image img',
//             '.faculty-photo img'
//         ];

//         for (const selector of selectors) {
//             const img = $(selector).first();
//             if (img.length && img.attr('src')) {
//                 let src = img.attr('src');
//                 if (!src.startsWith('http')) {
//                     src = src.startsWith('/') ? BASE_URL + src : profileUrl.replace(/\/[^/]*$/, '/') + src;
//                 }
//                 return src;
//             }
//         }
//         return null;
//     } catch (error) {
//         console.error(`  ⚠️ Failed to fetch image for ${profileUrl}: ${error.message}`);
//         return null;
//     }
// }

// async function importFaculty() {
//     try {
//         // 1. Read the faculty list HTML
//         const html = fs.readFileSync('faculty.aspx', 'utf8');
//         const $ = cheerio.load(html);

//         const teachers = [];

//         // Find all teacher rows (each row contains .person-name and .Person-School)
//         $('tr').each((i, row) => {
//             const nameCell = $(row).find('td.person-name');
//             const schoolCell = $(row).find('td.Person-School');

//             if (nameCell.length && schoolCell.length) {
//                 const name = nameCell.find('a').text().trim();
//                 const profileUrl = nameCell.find('a').attr('href');
//                 const department = schoolCell.text().trim();

//                 if (name && department) {
//                     let absoluteUrl = null;
//                     if (profileUrl && !profileUrl.startsWith('http')) {
//                         absoluteUrl = BASE_URL + (profileUrl.startsWith('/') ? '' : '/') + profileUrl;
//                     }
//                     teachers.push({ name, department, profileUrl: absoluteUrl });
//                 }
//             }
//         });

//         console.log(`✅ Found ${teachers.length} teachers. Now fetching images (this may take a while)...\n`);

//         let inserted = 0;
//         let skipped = 0;
//         let withImage = 0;

//         for (let i = 0; i < teachers.length; i++) {
//             const teacher = teachers[i];
//             process.stdout.write(`[${i+1}/${teachers.length}] ${teacher.name}... `);

//             // Check duplicate by name
//             const [existing] = await db.query('SELECT id FROM teachers WHERE name = ?', [teacher.name]);
//             if (existing.length > 0) {
//                 console.log('⏭️ duplicate, skipping.');
//                 skipped++;
//                 continue;
//             }

//             // Fetch image from profile page (optional – you can skip if you want)
//             let imageUrl = null;
//             if (teacher.profileUrl) {
//                 imageUrl = await getTeacherImage(teacher.profileUrl);
//                 if (imageUrl) {
//                     console.log('✅ with image');
//                     withImage++;
//                 } else {
//                     console.log('✅ no image');
//                 }
//             } else {
//                 console.log('✅ no profile link');
//             }

//             // Insert into database
//             await db.query(
//                 'INSERT INTO teachers (name, department, image_url) VALUES (?, ?, ?)',
//                 [teacher.name, teacher.department, imageUrl]
//             );
//             inserted++;

//             // Delay to avoid overloading the server
//             await sleep(DELAY_MS);
//         }

//         console.log(`\n📊 SUMMARY:
//         - Total teachers found: ${teachers.length}
//         - Inserted: ${inserted}
//         - Skipped (duplicate): ${skipped}
//         - With images: ${withImage}
//         `);
//         process.exit(0);
//     } catch (error) {
//         console.error('❌ Error:', error);
//         process.exit(1);
//     }
// }

// importFaculty();