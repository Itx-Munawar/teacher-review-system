import React from 'react';

interface SkeletonProps {
    width?: string | number;
    height?: string | number;
    borderRadius?: string;
    className?: string;
    style?: React.CSSProperties;
}

const Skeleton: React.FC<SkeletonProps> = ({
    width = '100%',
    height = '1rem',
    borderRadius = '8px',
    className = '',
    style,
}) => (
    <div
        className={`skeleton ${className}`}
        style={{
            width,
            height,
            borderRadius,
            ...style,
        }}
    />
);

/** Teacher card skeleton */
export const TeacherCardSkeleton: React.FC = () => (
    <div className="skeleton-card">
        <div className="skeleton skeleton-avatar" />
        <div className="skeleton-card-text">
            <Skeleton height="1.1rem" width="70%" />
            <Skeleton height="0.85rem" width="50%" />
            <Skeleton height="0.75rem" width="35%" />
        </div>
    </div>
);

/** Teacher detail skeleton */
export const TeacherDetailSkeleton: React.FC = () => (
    <div className="skeleton-detail">
        <Skeleton height="180px" borderRadius="50%" width="180px" style={{ margin: '0 auto 1.5rem' }} />
        <Skeleton height="1.8rem" width="60%" style={{ margin: '0 auto 0.75rem' }} />
        <Skeleton height="1rem" width="30%" style={{ margin: '0 auto 1.5rem' }} />
        <Skeleton height="2.5rem" width="200px" style={{ margin: '0 auto 2rem' }} />
        <Skeleton height="1.2rem" width="40%" style={{ marginBottom: '1rem' }} />
        {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-review-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                    <Skeleton height="0.85rem" width="120px" />
                    <Skeleton height="0.85rem" width="80px" />
                </div>
                <Skeleton height="2.5rem" width="90%" />
            </div>
        ))}
    </div>
);

/** Compare view skeleton */
export const CompareSkeleton: React.FC = () => (
    <div className="skeleton-compare">
        <Skeleton height="2rem" width="250px" style={{ margin: '0 auto 1.5rem' }} />
        <Skeleton height="3rem" width="100%" style={{ marginBottom: '1rem' }} />
        <div style={{ display: 'flex', gap: '1rem' }}>
            {[1, 2].map((i) => (
                <div key={i} style={{ flex: 1 }}>
                    <Skeleton height="120px" borderRadius="12px" style={{ marginBottom: '0.75rem' }} />
                    <Skeleton height="1rem" width="60%" style={{ marginBottom: '0.5rem' }} />
                    <Skeleton height="0.85rem" width="40%" />
                </div>
            ))}
        </div>
    </div>
);

/** Review card skeleton */
export const ReviewCardSkeleton: React.FC = () => (
    <div className="skeleton-review-card">
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <Skeleton height="0.85rem" width="120px" />
            <Skeleton height="0.85rem" width="80px" />
        </div>
        <Skeleton height="2.5rem" width="90%" />
    </div>
);

export default Skeleton;
