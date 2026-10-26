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

// Teacher names get the same whitespace clean-up: a double space ("Dr  Nosheen
// Qamar") sorted the row apart from its neighbours and broke exact search.
const normalizeTeacherName = (value) => String(value || '').replace(/\s+/g, ' ').trim();

// Short forms students and admins type for a school. "SST" is matched against
// the initials of the significant words ("School of Systems and Technology"),
// "HSM" against a short form in brackets ("Dr Hasan Murad School of Management
// (HSM)"). Only a single unambiguous match counts, so an unknown abbreviation
// is kept as typed instead of being guessed.
const ACRONYM_STOP_WORDS = new Set(['of', 'and', 'the', 'for', 'in', '&']);
const departmentAcronyms = (department) => {
    const out = new Set();
    const bracket = /\(([A-Za-z]{2,10})\)\s*$/.exec(department);
    if (bracket) out.add(bracket[1].toUpperCase());
    const words = department.replace(/\([^)]*\)/g, ' ').split(/\s+/).filter(Boolean);
    const initials = words
        .filter((w) => !ACRONYM_STOP_WORDS.has(w.toLowerCase()))
        .map((w) => w[0])
        .join('')
        .toUpperCase();
    if (initials.length >= 2) out.add(initials);
    return out;
};
const looksLikeAcronym = (value) => /^[A-Za-z]{3,8}$/.test(value) && value === value.toUpperCase();

// Picks the existing department an acronym stands for, from a list of known
// department names. Returns null when there is no single clear match.
const departmentForAcronym = (value, departments) => {
    if (!looksLikeAcronym(value)) return null;
    const wanted = value.toUpperCase();
    const matches = [...new Set(departments)].filter(
        (dept) => dept.toUpperCase() !== wanted && departmentAcronyms(dept).has(wanted)
    );
    return matches.length === 1 ? matches[0] : null;
};

const canonicalDepartment = async (value) => {
    const cleaned = normalizeDepartment(value);
    if (!cleaned) return cleaned;
    const [rows] = await db.query('SELECT department FROM teachers WHERE LOWER(department) = LOWER(?) LIMIT 1', [cleaned]);
    if (rows.length > 0 && !looksLikeAcronym(cleaned)) return rows[0].department;
    if (looksLikeAcronym(cleaned)) {
        const [all] = await db.query('SELECT DISTINCT department FROM teachers');
        const expanded = departmentForAcronym(cleaned, all.map((r) => r.department));
        if (expanded) return expanded;
    }
    return rows.length > 0 ? rows[0].department : cleaned;
};

module.exports = {
    isUsableTeacherImageUrl,
    normalizeReviewText,
    normalizeDepartment,
    normalizeTeacherName,
    departmentForAcronym,
    canonicalDepartment
};
