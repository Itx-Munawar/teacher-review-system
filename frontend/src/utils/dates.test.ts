import { describe, it, expect } from 'vitest';
import { formatDate, formatMonth, relativeDate } from './dates';

describe('dates', () => {
    const now = new Date(2026, 9, 28, 12, 0, 0).getTime();

    it('formats day first with short month names', () => {
        expect(formatDate(new Date(2026, 8, 9, 10).toISOString())).toBe('9 Sep 2026');
        expect(formatMonth(new Date(2026, 9, 1).toISOString())).toBe('Oct 2026');
    });

    it('returns an empty string for missing or broken dates', () => {
        expect(formatDate(undefined)).toBe('');
        expect(formatDate('not a date')).toBe('');
        expect(relativeDate(null)).toBe('');
    });

    it('uses friendly words for recent dates and the plain date after a month', () => {
        expect(relativeDate(new Date(now - 2 * 3600e3).toISOString(), now)).toBe('Today');
        expect(relativeDate(new Date(now - 30 * 3600e3).toISOString(), now)).toBe('Yesterday');
        expect(relativeDate(new Date(now - 3 * 86400e3).toISOString(), now)).toBe('3 days ago');
        expect(relativeDate(new Date(now - 8 * 86400e3).toISOString(), now)).toBe('1 week ago');
        expect(relativeDate(new Date(now - 20 * 86400e3).toISOString(), now)).toBe('2 weeks ago');
        expect(relativeDate(new Date(2026, 4, 20, 12).toISOString(), now)).toBe('20 May 2026');
    });
});
