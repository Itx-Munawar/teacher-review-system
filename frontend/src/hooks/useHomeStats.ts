import { useEffect, useState } from 'react';
import { getStats, type SiteStats } from '../services/api';

// One request per page load, shared by the desktop hero and the mobile intro.
let pending: Promise<SiteStats | null> | null = null;
const loadOnce = () => {
    if (!pending) pending = getStats().catch(() => { pending = null; return null; });
    return pending;
};

/** Headline numbers for the home page; null until loaded (or if the call fails). */
export const useHomeStats = (): SiteStats | null => {
    const [stats, setStats] = useState<SiteStats | null>(null);
    useEffect(() => {
        let alive = true;
        loadOnce().then((s) => { if (alive && s) setStats(s); });
        return () => { alive = false; };
    }, []);
    return stats;
};

const prefersReducedMotion = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Counts from 0 to `target` with an ease-out curve (instant under reduced motion). */
export const useCountUp = (target: number, duration = 1600): number => {
    const [value, setValue] = useState(0);
    useEffect(() => {
        if (!target) { setValue(0); return undefined; }
        if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') { setValue(target); return undefined; }
        let frame = 0;
        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration);
            setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
            if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [target, duration]);
    return value;
};
