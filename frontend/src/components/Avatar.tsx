import React from 'react';

const getInitials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';

interface AvatarProps {
    name: string;
    imageUrl?: string | null;
    className?: string;
    alt?: string;
}

const Avatar: React.FC<AvatarProps> = ({ name, imageUrl, className = '', alt }) => {
    if (imageUrl) {
        return <img src={imageUrl} alt={alt || name} className={`avatar-img ${className}`} loading="lazy" />;
    }
    return (
        <div className={`avatar-fallback ${className}`} aria-hidden="true">
            {getInitials(name)}
        </div>
    );
};

export default Avatar;
