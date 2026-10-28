const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toDate = (iso?: string | null): Date | null => {
    if (!iso) return null;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
};

/** "28 Oct 2026" - day first, the way dates are read in Pakistan. */
export const formatDate = (iso?: string | null): string => {
    const d = toDate(iso);
    return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
};

/** "Oct 2026" */
export const formatMonth = (iso?: string | number | null): string => {
    const d = iso === null || iso === undefined ? null : new Date(iso);
    return d && !Number.isNaN(d.getTime()) ? `${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
};

/** "Today", "3 days ago", "2 weeks ago", then the plain date. */
export const relativeDate = (iso?: string | null, now: number = Date.now()): string => {
    const d = toDate(iso);
    if (!d) return '';
    const days = Math.floor((now - d.getTime()) / 86400000);
    if (days < 0) return formatDate(iso);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    if (days < 30) {
        const weeks = Math.floor(days / 7);
        return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`;
    }
    return formatDate(iso);
};
