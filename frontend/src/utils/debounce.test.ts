import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from './debounce';

describe('debounce', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('delays the call until the delay has elapsed', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 300);

        debounced('first');
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(299);
        expect(fn).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('first');
    });

    it('only calls the function once with the latest args when invoked repeatedly', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 200);

        debounced('a');
        debounced('b');
        debounced('c');

        vi.advanceTimersByTime(200);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('c');
    });

    it('can cancel a pending call', () => {
        const fn = vi.fn();
        const debounced = debounce(fn, 200);

        debounced('pending');
        debounced.cancel();

        vi.advanceTimersByTime(200);
        expect(fn).not.toHaveBeenCalled();

        // A later call still works normally.
        debounced('after-cancel');
        vi.advanceTimersByTime(200);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('after-cancel');
    });
});
