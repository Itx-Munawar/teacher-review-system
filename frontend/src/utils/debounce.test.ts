import { debounce } from './debounce';

describe('debounce', () => {
    it('delays the call until the delay has elapsed', () => {
        jest.useFakeTimers();
        const fn = jest.fn();
        const debounced = debounce(fn, 300);

        debounced('first');
        expect(fn).not.toHaveBeenCalled();

        jest.advanceTimersByTime(299);
        expect(fn).not.toHaveBeenCalled();

        jest.advanceTimersByTime(1);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('first');

        jest.useRealTimers();
    });

    it('only calls the function once with the latest args when invoked repeatedly', () => {
        jest.useFakeTimers();
        const fn = jest.fn();
        const debounced = debounce(fn, 200);

        debounced('a');
        debounced('b');
        debounced('c');

        jest.advanceTimersByTime(200);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('c');

        jest.useRealTimers();
    });

    it('can cancel a pending call', () => {
        jest.useFakeTimers();
        const fn = jest.fn();
        const debounced = debounce(fn, 200);

        debounced('pending');
        debounced.cancel();

        jest.advanceTimersByTime(200);
        expect(fn).not.toHaveBeenCalled();

        // A later call still works normally.
        debounced('after-cancel');
        jest.advanceTimersByTime(200);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(fn).toHaveBeenCalledWith('after-cancel');

        jest.useRealTimers();
    });
});
