import React, { useEffect, useMemo, useRef, useState } from 'react';
import { isUsableImageUrl, thumbUrl, thumbSrcSet, originalViaSite } from '../utils/imageThumb';

/**
 * A photo source that has neither loaded nor errored after this long (counted
 * from when it scrolls into view) is treated as failed. Blocked hosts often
 * stall instead of erroring, which used to leave an empty circle forever.
 */
export const PHOTO_STALL_MS = 10000;

const getInitials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

// Same gradient as `.avatar-fallback`. Painted behind the <img> so a coloured
// circle is on screen immediately while the photo downloads (on a slow
// connection that can be seconds), instead of an empty gap.
const PLACEHOLDER_STYLE: React.CSSProperties = {
    background: '#F7F1E6',
};

interface AvatarProps {
    name: string;
    imageUrl?: string | null;
    className?: string;
    alt?: string;
    /**
     * Display width in CSS pixels — drives how large a thumbnail we request.
     * The 2x srcset candidate covers high-DPI phones, so this should be about
     * the CSS size of the circle, not double it.
     */
    size?: number;
    /**
     * Set for photos that are on screen at first paint (top of a list, the
     * detail hero). They load immediately at high priority instead of being
     * deferred by lazy loading, which on mobile waits for layout first.
     */
    priority?: boolean;
}

/**
 * Teacher photo with a graceful fallback chain:
 * resized thumbnail (via our domain) → original (via our domain) →
 * original straight from UMT → initials.
 *
 * The thumbnail is ~1.5 KB instead of 20–230 KB, and a failed or broken URL
 * degrades to initials rather than a broken-image icon.
 */
const Avatar: React.FC<AvatarProps> = ({ name, imageUrl, className = '', alt, size = 80, priority = false }) => {
    // Candidate sources, best first. Fewer than two means nothing to proxy.
    const sources = useMemo(() => {
        if (!isUsableImageUrl(imageUrl)) return [];
        const original = (imageUrl as string).trim();
        return Array.from(new Set([thumbUrl(original, size), originalViaSite(original), original]));
    }, [imageUrl, size]);

    const [index, setIndex] = useState(0);
    const imgRef = useRef<HTMLImageElement>(null);

    // Start from the best source again whenever the teacher/image changes
    useEffect(() => {
        setIndex(0);
    }, [sources]);

    // Stall watchdog: move on if the current source hangs. The last source has
    // no watchdog — a slow photo is still better than initials.
    useEffect(() => {
        const el = imgRef.current;
        if (!el || index >= sources.length - 1) return undefined;
        const loaded = () => el.complete && el.naturalWidth > 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const arm = () => {
            if (timer !== undefined || loaded()) return;
            timer = setTimeout(() => {
                if (!loaded()) setIndex(i => (i === index ? i + 1 : i));
            }, PHOTO_STALL_MS);
        };
        let observer: IntersectionObserver | undefined;
        if (priority || typeof IntersectionObserver === 'undefined') {
            arm();
        } else {
            // Lazy photos below the fold haven't started loading yet: only
            // start counting once they are (nearly) on screen.
            observer = new IntersectionObserver((entries) => {
                if (entries.some(e => e.isIntersecting)) { arm(); observer?.disconnect(); }
            }, { rootMargin: '200px' });
            observer.observe(el);
        }
        return () => {
            if (timer !== undefined) clearTimeout(timer);
            observer?.disconnect();
        };
    }, [index, sources, priority]);

    if (sources.length === 0 || index >= sources.length) {
        return (
            <div className={`${className}`} aria-hidden="true">
                {getInitials(name)}
            </div>
        );
    }


    // React 18 doesn't know the camelCase `fetchPriority` prop (it logs a warning); the
    // lowercase attribute is what the browser reads and what React tells us to spell.
    const priorityAttrs = priority ? { fetchpriority: 'high' } : {};

    return (
        <img
            ref={imgRef}
            src={sources[index]}
            srcSet={index === 0 ? thumbSrcSet((imageUrl as string).trim(), size) : undefined}
            alt={alt || name}
            className={`${className}`}
            style={PLACEHOLDER_STYLE}
            loading={priority ? 'eager' : 'lazy'}
            {...priorityAttrs}
            decoding="async"
            onError={() => setIndex(i => i + 1)}
        />
    );
};

export default Avatar;
