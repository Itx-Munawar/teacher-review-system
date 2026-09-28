import React, { useEffect, useMemo, useState } from 'react';
import { isUsableImageUrl, thumbUrl, thumbSrcSet } from '../utils/imageThumb';

const getInitials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

interface AvatarProps {
    name: string;
    imageUrl?: string | null;
    className?: string;
    alt?: string;
    /** Display width in CSS pixels — drives how large a thumbnail we request. */
    size?: number;
}

/**
 * Teacher photo with a graceful fallback chain:
 * resized thumbnail → original image → initials.
 *
 * The thumbnail is ~1.5 KB instead of 20–230 KB, and a failed or broken URL
 * degrades to initials rather than a broken-image icon.
 */
const Avatar: React.FC<AvatarProps> = ({ name, imageUrl, className = '', alt, size = 160 }) => {
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

    return (
        <img
            src={sources[index]}
            srcSet={isThumb ? thumbSrcSet(sources[1], size) : undefined}
            alt={alt || name}
            className={`${className}`}
            loading="lazy"
            decoding="async"
            onError={() => setIndex(i => i + 1)}
        />
    );
};

export default Avatar;
