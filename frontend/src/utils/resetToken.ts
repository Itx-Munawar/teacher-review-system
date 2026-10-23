/**
 * The reset token arrives from the emailed link. New links carry it in the URL
 * fragment (#token=...), which never reaches a server, a proxy access log or a
 * Referer header; older links still use ?token=..., so both are accepted.
 *
 * Kept separate from the component so the parsing rule is testable on its own.
 */
export function extractResetToken(hash: string, search: string): string {
    const fromFragment = new URLSearchParams((hash || '').replace(/^#/, ''));
    const fromQuery = new URLSearchParams((search || '').replace(/^\?/, ''));
    const token = fromFragment.get('token') || fromQuery.get('token') || '';
    // A token is 64 hex chars from crypto.randomBytes(32). Anything longer is a
    // paste error or an attempt to push a huge string into the reset request.
    if (token.length > 128) return '';
    return token;
}
