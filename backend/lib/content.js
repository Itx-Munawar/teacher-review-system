// Text and data normalisation helpers for teachers and reviews.

const db = require('../db');

// Mirrors isUsableImageUrl() in frontend/src/utils/imageThumb.ts, so the DB is
// cleaned using exactly the rule the UI uses to choose between a photo and an
// initials avatar. A bare directory URL such as
// "https://admin.umt.edu.pk/Media/UserProfile/" is not a usable image.
const isUsableTeacherImageUrl = (url) => {
    const trimmed = (url || '').trim();
    if (!/^https?:\/\//i.test(trimmed)) return false;
    try {
        const { hostname, pathname } = new URL(trimmed);
        if (!hostname) return false;
        const filename = pathname.split('/').filter(Boolean).pop() || '';
        return /\.(jpe?g|png|webp|gif|avif)$/i.test(filename);
    } catch (error) {
        return false;
    }
};

// Normalises user text for duplicate comparison: lowercase, punctuation and
// whitespace collapsed, so "Best teacher!!" and "best   teacher" are equal.
const normalizeReviewText = (text) =>
    String(text || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Departments are free text on each teacher row, so normalise what an admin
// types: collapse whitespace, and reuse the spelling/case of an existing
// department (case-insensitive match) so "computer science" and
// "Computer Science" never become two separate filters.
const normalizeDepartment = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
const canonicalDepartment = async (value) => {
    const cleaned = normalizeDepartment(value);
    if (!cleaned) return cleaned;
    const [rows] = await db.query('SELECT department FROM teachers WHERE LOWER(department) = LOWER(?) LIMIT 1', [cleaned]);
    return rows.length > 0 ? rows[0].department : cleaned;
};

module.exports = {
    isUsableTeacherImageUrl,
    normalizeReviewText,
    normalizeDepartment,
    canonicalDepartment
};
