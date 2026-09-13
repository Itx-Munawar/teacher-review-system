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

        // Lock body scroll while modal is open (prevents background scrolling on mobile)
        document.body.style.overflow = 'hidden';
        document.body.style.touchAction = 'none';
        return () => {
            document.body.style.overflow = '';
            document.body.style.touchAction = '';
        };
    }, [isActive]);

    useEffect(() => {
        if (!isActive) return;

        // Store the element that had focus before the trap
        previousFocusRef.current = document.activeElement as HTMLElement;

        // Focus the container itself, NOT the first input. Auto-focusing an
        // input pops open the mobile keyboard before the user has chosen a
        // field. With the container focused, the keyboard stays hidden until
        // the user taps a field. (Container needs tabIndex={-1} to be focusable.)
        const timer = setTimeout(() => {
            containerRef.current?.focus();
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

    // Track the mobile keyboard via visualViewport and expose its height as a
    // CSS variable (--kb-height). Sticky bottom buttons use it to sit exactly
    // above the keyboard instead of being covered or floating mid-screen.
    useEffect(() => {
        if (!isActive || !window.visualViewport) return;
        const vv = window.visualViewport;
        const root = document.documentElement;
        const update = () => {
            const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
            root.style.setProperty('--kb-height', `${Math.round(kb)}px`);
        };
        update();
        vv.addEventListener('resize', update);
        vv.addEventListener('scroll', update);
        return () => {
            vv.removeEventListener('resize', update);
            vv.removeEventListener('scroll', update);
            root.style.setProperty('--kb-height', '0px');
        };
    }, [isActive]);

    return containerRef;
}
