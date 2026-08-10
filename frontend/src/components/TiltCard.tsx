import React, { useRef } from 'react';

interface TiltCardProps {
    children: React.ReactNode;
    maxTilt?: number;
    glare?: boolean;
    className?: string;
    onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
    style?: React.CSSProperties;
}

const TiltCard: React.FC<TiltCardProps> = ({
    children,
    maxTilt = 12,
    glare = true,
    className = '',
    onClick,
    style,
}) => {
    const cardRef = useRef<HTMLDivElement>(null);

    const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
        const el = cardRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        const rotateY = (x - 0.5) * 2 * maxTilt;
        const rotateX = (0.5 - y) * 2 * maxTilt;
        el.style.transform = `perspective(900px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(10px) scale3d(1.02, 1.02, 1.02)`;
        el.style.setProperty('--tilt-x', `${x * 100}%`);
        el.style.setProperty('--tilt-y', `${y * 100}%`);
    };

    const handleMouseLeave = () => {
        const el = cardRef.current;
        if (!el) return;
        el.style.transform = '';
        el.style.setProperty('--tilt-x', '50%');
        el.style.setProperty('--tilt-y', '50%');
    };

    return (
        <div
            ref={cardRef}
            className={`tilt-card ${glare ? 'with-glare' : ''} ${className}`.trim()}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
            onClick={onClick}
            style={style}
        >
            {children}
        </div>
    );
};

export default TiltCard;
