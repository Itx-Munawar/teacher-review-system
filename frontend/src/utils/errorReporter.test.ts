import { describe, it, expect, vi, beforeEach } from 'vitest';

const post = vi.fn(() => Promise.resolve({ data: {} }));
vi.mock('../services/api', () => ({ default: { post: (...args: unknown[]) => post(...(args as [])) } }));

import { reportError, _resetErrorReporter } from './errorReporter';

describe('errorReporter', () => {
    beforeEach(() => {
        post.mockClear();
        _resetErrorReporter();
    });

    it('sends real errors with the page url and stack', () => {
        const err = new TypeError("Cannot read properties of undefined (reading 'name')");
        reportError(err, '\n    at TeacherCard');
        expect(post).toHaveBeenCalledTimes(1);
        const [url, body] = post.mock.calls[0] as unknown as [string, { message: string; stack: string; url: string }];
        expect(url).toBe('/client-errors');
        expect(body.message).toBe("TypeError: Cannot read properties of undefined (reading 'name')");
        expect(body.stack).toContain('component stack');
        expect(body.url).toBe(window.location.href);
    });

    it('skips API errors, noise and duplicates, and caps reports per page', () => {
        reportError({ isAxiosError: true, message: 'Request failed with status code 500' });
        reportError(new Error('ResizeObserver loop completed with undelivered notifications.'));
        reportError(new TypeError('Failed to fetch'));
        expect(post).not.toHaveBeenCalled();

        reportError(new Error('same bug'));
        reportError(new Error('same bug'));
        expect(post).toHaveBeenCalledTimes(1);

        for (let i = 0; i < 10; i += 1) reportError(new Error(`bug ${i}`));
        expect(post).toHaveBeenCalledTimes(5);
    });
});
