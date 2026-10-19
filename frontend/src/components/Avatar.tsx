import React, { useEffect, useMemo, useState } from 'react';
import { isUsableImageUrl, thumbUrl, thumbSrcSet } from '../utils/imageThumb';

const getInitials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

// Same gradient as `.avatar-fallback`. Painted behind the <img> so a coloured
// circle is on screen immediately while the photo downloads (on a slow
// connection that can be seconds), instead of an empty gap.
const PLACEHOLDER_STYLE: React.CSSProperties = {
    background: 'linear-gradient(135deg, #ff5e9c, #a855f7, #00c9ff)',
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
 * resized thumbnail → original image → initials.
 *
 * The thumbnail is ~1.5 KB instead of 20–230 KB, and a failed or broken URL
 * degrades to initials rather than a broken-image icon.
 */
const Avatar: React.FC<AvatarProps> = ({ name, imageUrl, className = '', alt, size = 80, priority = false }) => {
    // Candidate sources, best first. Fewer than two means nothing to proxy.
    const sources = useMemo(() => {
        if (!isUsableImageUrl(imageUrl)) return [];
        const original = (imageUrl as string).trim();
        const thumb = thumbUrl(original, size);
        return thumb === original ? [original] : [thumb, original];
    }, [imageUrl, size]);

    const [index, setIndex] = useState(0);

    // Start from the best source again whenever the teacher/image changes
    useEffect(() => {
        setIndex(0);
    }, [sources]);

    if (sources.length === 0 || index >= sources.length) {
        return (
            <div className={`${className}`} aria-hidden="true">
                {getInitials(name)}
            </div>
        );
    }

    const isThumb = index === 0 && sources.length > 1;

    // React 18 doesn't know the camelCase `fetchPriority` prop (it logs a warning); the
    // lowercase attribute is what the browser reads and what React tells us to spell.
    const priorityAttrs = priority ? { fetchpriority: 'high' } : {};

    return (
        <img
            src={sources[index]}
            srcSet={isThumb ? thumbSrcSet(sources[1], size) : undefined}
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
