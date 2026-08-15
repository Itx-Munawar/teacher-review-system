export const haptic = (pattern: number | number[] = 10): void => {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try {
            navigator.vibrate(pattern);
        } catch {
            /* no-op */
        }
    }
};
