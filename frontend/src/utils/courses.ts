/** A review-like object; `courses` can arrive as JSON text or a legacy BLOB. */
interface ReviewLike {
    courses?: unknown;
    course?: unknown;
}

/**
 * Decode a MySQL BLOB-style payload without relying on Node's Buffer global.
 * Older deployments stored `courses` as a BLOB, so the JSON API can return
 * `{ type: 'Buffer', data: [...] }`; browsers have no Buffer constructor.
 */
const bufferToString = (value: { data: number[] }): string => {
    try {
        return new TextDecoder().decode(new Uint8Array(value.data));
    } catch {
        return value.data.map((byte) => String.fromCharCode(byte)).join('');
    }
};

/**
 * Extract course names from a review, handling a plain string, an array, a
 * Buffer-shaped object and double-encoded JSON. Returns [] for empty/invalid
 * values and never throws.
 */
export const extractCourses = (review: ReviewLike): string[] => {
    const raw = review.courses || review.course;
    if (!raw) return [];

    let str: string;
    const bufferLike = raw as { type?: unknown; data?: unknown };
    if (typeof raw === 'object' && raw !== null && bufferLike.type === 'Buffer' && Array.isArray(bufferLike.data)) {
        str = bufferToString({ data: bufferLike.data as number[] });
    } else {
        str = String(raw);
    }

    if (!str || str === 'null' || str === '[]') return [];

    const toList = (value: unknown): string[] => {
        const list = Array.isArray(value) ? value : [value];
        return list
            .filter((course) => course !== null && course !== undefined && typeof course !== 'object')
            .map((course) => String(course).trim())
            .filter((course) => course.length > 0);
    };

    try {
        return toList(JSON.parse(str));
    } catch {
        // If JSON.parse fails, treat the raw value as a single course name.
        const fallback = str.trim();
        return fallback && fallback !== 'null' ? [fallback] : [];
    }
};
