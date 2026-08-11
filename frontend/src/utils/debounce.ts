export function debounce<A extends unknown[]>(
    fn: (...args: A) => void,
    delay: number
): (...args: A) => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    return (...args: A) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
            timer = null;
            fn(...args);
        }, delay);
    };
}
