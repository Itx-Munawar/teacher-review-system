import React from 'react';
import { Link } from 'react-router-dom';

interface WelcomePanelProps {
    departments: { department: string; teacher_count: number }[];
}

/** Start page shown in the main column when no teacher is open. */
const WelcomePanel: React.FC<WelcomePanelProps> = ({ departments }) => (
    <div className="welcome-message">
        <div className="welcome-crest">
            <span className="welcome-crest-plate">
                <img
                    src={`${import.meta.env.BASE_URL}umt-logo.webp`}
                    alt="University of Management and Technology"
                    className="welcome-crest-img"
                    width={96}
                    height={96}
                    decoding="async"
                />
            </span>
        </div>
        <p className="welcome-eyebrow">University of Management and Technology · Lahore</p>
        <h2 className="welcome-title">Reviews from UMT students, for UMT students.</h2>
        <p className="welcome-hint-desktop">Find a teacher to read reviews, or add what you know about a class.</p>
        <p className="welcome-hint-mobile">Find a teacher above to read reviews, or add what you know about a class.</p>
        <p className="welcome-trust">Anonymous. Moderated. Free.</p>
        {departments.length > 0 && (
            <div className="department-links">
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

export default WelcomePanel;
