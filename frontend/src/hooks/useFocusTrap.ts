import { useEffect, useRef } from 'react';

const FOCUSABLE_SELECTORS = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'textarea:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
].join(', ');

export function useFocusTrap(isActive: boolean) {
    const containerRef = useRef<HTMLDivElement>(null);
    const previousFocusRef = useRef<HTMLElement | null>(null);

    useEffect(() => {
        if (!isActive) return;

        // Store the element that had focus before the trap
        previousFocusRef.current = document.activeElement as HTMLElement;

        // Focus the first focusable element in the container
        const timer = setTimeout(() => {
            if (containerRef.current) {
                const focusable = containerRef.current.querySelectorAll(FOCUSABLE_SELECTORS);
                if (focusable.length > 0) {
                    (focusable[0] as HTMLElement).focus();
                }
            }
        }, 50);

        return () => {
            clearTimeout(timer);
            // Restore focus when trap is deactivated
            if (previousFocusRef.current && previousFocusRef.current.focus) {
                previousFocusRef.current.focus();
            }
        };
    }, [isActive]);

    useEffect(() => {
        if (!isActive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key !== 'Tab' || !containerRef.current) return;

            const focusable = containerRef.current.querySelectorAll(FOCUSABLE_SELECTORS);
            if (focusable.length === 0) return;

            const first = focusable[0] as HTMLElement;
            const last = focusable[focusable.length - 1] as HTMLElement;

            if (e.shiftKey) {
                // Shift+Tab: if on first element, wrap to last
                if (document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            } else {
                // Tab: if on last element, wrap to first
                if (document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isActive]);

    return containerRef;
}
