import React from 'react';
import Avatar from './Avatar';
import { useCountUp } from '../hooks/useHomeStats';
import type { SiteStats } from '../services/api';
import type { Teacher } from '../types';

/** Splits a line into words so each one can blur in on its own beat. */
const Words: React.FC<{ text: string; start: number; className?: string }> = ({ text, start, className }) => (
    <>
        {text.split(' ').map((word, i) => (
            <span key={`${word}-${i}`} className={`home-word${className ? ` ${className}` : ''}`} style={{ '--i': start + i } as React.CSSProperties}>
                {word}{' '}
            </span>
        ))}
    </>
);

/** "Reviews from / UMT students, / for UMT students." with the second line as a muted italic accent. */
export const HeroTitle: React.FC<{ as?: 'h1' | 'h2'; className?: string }> = ({ as: Tag = 'h2', className = '' }) => (
    <Tag className={`home-title ${className}`.trim()}>
        <span className="home-title-line"><Words text="Reviews from" start={0} /></span>
        <span className="home-title-line"><Words text="UMT students," start={2} /></span>
        <span className="home-title-line home-title-accent"><Words text="for UMT students." start={4} /></span>
    </Tag>
);

const Stat: React.FC<{ value: number; label: string }> = ({ value, label }) => {
    const shown = useCountUp(value);
    return (
        <div className="home-stat">
            <dt className="home-stat-label">{label}</dt>
            <dd className="home-stat-value">{shown.toLocaleString('en-US')}</dd>
        </div>
    );
};

/** Teachers · Reviews · Departments, counting up once the numbers arrive. */
export const HeroStats: React.FC<{ stats: SiteStats | null; fallbackTeachers: number; fallbackDepartments: number }> = ({ stats, fallbackTeachers, fallbackDepartments }) => {
    const teachers = stats?.teachers || fallbackTeachers;
    const departments = stats?.departments || fallbackDepartments;
    if (!teachers) return null;
    return (
        <dl className="home-stats" aria-label="Site numbers">
            <Stat value={teachers} label="Teachers" />
            {stats?.reviews ? <Stat value={stats.reviews} label="Reviews" /> : null}
            {departments ? <Stat value={departments} label="Departments" /> : null}
        </dl>
    );
};

/** Overlapping photos of the most-reviewed teachers plus one line of social proof. */
export const ProofCluster: React.FC<{ teachers: Teacher[]; reviewedTeachers?: number }> = ({ teachers, reviewedTeachers }) => {
    const faces = teachers
        .filter((t) => t.image_url && (t.review_count || 0) > 0)
        .sort((a, b) => (b.review_count || 0) - (a.review_count || 0))
        .slice(0, 4);
    if (faces.length < 3) return null;
    return (
        <div className="home-proof">
            <span className="home-proof-faces" aria-hidden="true">
                {faces.map((t) => (
                    <Avatar key={t.id} name={t.name} imageUrl={t.image_url} size={36} className="home-proof-face" alt="" />
                ))}
            </span>
            <span className="home-proof-text">
                {reviewedTeachers
                    ? <>Students have reviewed <strong>{reviewedTeachers.toLocaleString('en-US')} teachers</strong> so far</>
                    : <>Real reviews from UMT students</>}
            </span>
        </div>
    );
};

const LOGO = `${import.meta.env.BASE_URL}umt-logo.webp`;

export const HeroBadge: React.FC = () => (
    <p className="home-badge">
        <span className="home-badge-chip">
            <img src={LOGO} alt="" width={18} height={18} decoding="async" />
            UMT Lahore
        </span>
        <span className="home-badge-text">Anonymous · Moderated · Free</span>
    </p>
);
