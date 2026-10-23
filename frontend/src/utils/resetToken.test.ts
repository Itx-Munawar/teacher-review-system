/**
 * Tests for the password-reset token source (src/utils/resetToken.ts).
 *
 * The emailed link moved the token from ?token= to #token= so it never reaches
 * a server or a Referer header, but old links must still work.
 */
import { extractResetToken } from './resetToken';

const TOKEN = 'a'.repeat(64);

describe('extractResetToken', () => {
    it('reads the token from the fragment', () => {
        expect(extractResetToken(`#token=${TOKEN}`, '')).toBe(TOKEN);
    });

    it('still reads the token from the query string for older links', () => {
        expect(extractResetToken('', `?token=${TOKEN}`)).toBe(TOKEN);
    });

    it('prefers the fragment when a link somehow carries both', () => {
        expect(extractResetToken(`#token=${TOKEN}`, '?token=oldvalue')).toBe(TOKEN);
    });

    it('returns an empty string when no token is present', () => {
        expect(extractResetToken('', '')).toBe('');
        expect(extractResetToken('#other=1', '?foo=2')).toBe('');
    });

    it('ignores unrelated fragment keys', () => {
        expect(extractResetToken('#section=reset', '')).toBe('');
    });

    it('rejects an absurdly long token instead of forwarding it to the API', () => {
        expect(extractResetToken(`#token=${'b'.repeat(5000)}`, '')).toBe('');
    });

    it('does not crash on a malformed percent escape or missing arguments', () => {
        // URLSearchParams leaves an invalid escape as literal text rather than
        // throwing; either way the page must still render its "invalid token"
        // state instead of blowing up.
        expect(() => extractResetToken('#token=%zz', '')).not.toThrow();
        expect(extractResetToken(undefined as unknown as string, undefined as unknown as string)).toBe('');
    });
});
