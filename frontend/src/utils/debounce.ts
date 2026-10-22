export interface DebouncedFunction<A extends unknown[]> {
    (...args: A): void;
    cancel: () => void;
}

export function debounce<A extends unknown[]>(
    fn: (...args: A) => void,
    delay: number
): DebouncedFunction<A> {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const debounced = (...args: A) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, delay);
    };

    debounced.cancel = () => {
        if (timer) {
            clearTimeout(timer);
            timer = null;
        }
    };

    return debounced;
}
