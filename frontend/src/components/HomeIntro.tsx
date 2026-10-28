import React from 'react';
import { HeroStats, HeroTitle } from './HomeHero';
import { useHomeStats } from '../hooks/useHomeStats';

/** Compact hero above the teacher list on phones (the desktop hero sits in the main column). */
const HomeIntro: React.FC<{ totalTeachersCount: number; departmentCount: number }> = ({ totalTeachersCount, departmentCount }) => {
    const stats = useHomeStats();
    return (
        <section className="home-intro" aria-label="About this site">
            <p className="home-intro-eyebrow home-rise" style={{ '--d': 0 } as React.CSSProperties}>
                <span className="home-dot" aria-hidden="true" />
                Anonymous · Moderated · Free
            </p>
            <HeroTitle className="home-intro-title" />
            <div className="home-rise" style={{ '--d': 4 } as React.CSSProperties}>
                <HeroStats stats={stats} fallbackTeachers={totalTeachersCount} fallbackDepartments={departmentCount} />
            </div>
        </section>
    );
};

export default HomeIntro;
