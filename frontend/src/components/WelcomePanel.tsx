import React from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { HeroBadge, HeroStats, HeroTitle, ProofCluster } from './HomeHero';
import { useHomeStats } from '../hooks/useHomeStats';
import { openChat } from '../utils/chatEvents';
import type { Teacher } from '../types';

interface WelcomePanelProps {
    departments: { department: string; teacher_count: number }[];
    teachers?: Teacher[];
    totalTeachersCount?: number;
    chatEnabled?: boolean;
    onFindTeacher?: () => void;
}

/** Start page shown in the main column when no teacher is open. */
const WelcomePanel: React.FC<WelcomePanelProps> = ({ departments, teachers = [], totalTeachersCount = 0, chatEnabled = false, onFindTeacher }) => {
    const stats = useHomeStats();
    return (
        <div className="welcome-message home-hero">
            <div className="home-rise" style={{ '--d': 0 } as React.CSSProperties}><HeroBadge /></div>
            <HeroTitle className="welcome-title" />
            <p className="home-sub home-rise" style={{ '--d': 3 } as React.CSSProperties}>
                Read what students really think before you pick a class, or share what you know to help the next batch.
            </p>
            <div className="home-actions home-rise" style={{ '--d': 4 } as React.CSSProperties}>
                {onFindTeacher && (
                    <button type="button" className="home-cta home-cta-primary" onClick={onFindTeacher}>
                        Find a teacher
                        <span className="home-cta-arrow" aria-hidden="true"><Icon name="search" size={15} /></span>
                    </button>
                )}
                {chatEnabled && (
                    <button type="button" className="home-cta home-cta-secondary" onClick={openChat}>
                        <Icon name="sparkles" size={16} />
                        Ask AI about a teacher
                    </button>
                )}
            </div>
            <div className="home-rise" style={{ '--d': 5 } as React.CSSProperties}>
                <ProofCluster teachers={teachers} reviewedTeachers={stats?.reviewed_teachers} />
            </div>
            <div className="home-rise" style={{ '--d': 6 } as React.CSSProperties}>
                <HeroStats stats={stats} fallbackTeachers={totalTeachersCount} fallbackDepartments={departments.length} />
            </div>
            {departments.length > 0 && (
                <div className="department-links home-rise" style={{ '--d': 7 } as React.CSSProperties}>
                    <h3>Browse by department</h3>
                    <div className="department-links-list">
                        {departments.map((d) => (
                            <Link key={d.department} to={`/department/${encodeURIComponent(d.department)}`} className="department-link-chip">
                                {d.department}
                            </Link>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default WelcomePanel;
