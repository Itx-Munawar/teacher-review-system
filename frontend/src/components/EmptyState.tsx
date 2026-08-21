import React from 'react';
import Icon, { IconName } from './Icon';

interface EmptyStateProps {
    icon: IconName;
    title: string;
    message?: string;
    action?: React.ReactNode;
}

/** Inline SVG illustrations for different empty states */
const illustrations: Record<string, React.ReactNode> = {
    'book-open': (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="empty-state-illustration">
            <rect x="40" y="20" width="120" height="120" rx="8" fill="rgba(102, 126, 234, 0.1)" stroke="rgba(102, 126, 234, 0.3)" strokeWidth="2" />
            <path d="M70 50h60M70 70h60M70 90h40" stroke="rgba(102, 126, 234, 0.4)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="150" cy="110" r="20" fill="rgba(118, 75, 162, 0.15)" stroke="rgba(118, 75, 162, 0.3)" strokeWidth="2" />
            <path d="M145 110l5 5 10-10" stroke="rgba(118, 75, 162, 0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    ),
    'compare': (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="empty-state-illustration">
            <rect x="20" y="30" width="70" height="100" rx="8" fill="rgba(102, 126, 234, 0.1)" stroke="rgba(102, 126, 234, 0.3)" strokeWidth="2" />
            <rect x="110" y="30" width="70" height="100" rx="8" fill="rgba(118, 75, 162, 0.1)" stroke="rgba(118, 75, 162, 0.3)" strokeWidth="2" />
            <path d="M90 80h20" stroke="rgba(251, 191, 36, 0.5)" strokeWidth="2" strokeLinecap="round" />
            <path d="M95 75l5 5-5 5" stroke="rgba(251, 191, 36, 0.5)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="55" cy="60" r="12" fill="rgba(102, 126, 234, 0.2)" />
            <circle cx="145" cy="60" r="12" fill="rgba(118, 75, 162, 0.2)" />
        </svg>
    ),
    'help': (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="empty-state-illustration">
            <circle cx="100" cy="80" r="50" fill="rgba(102, 126, 234, 0.1)" stroke="rgba(102, 126, 234, 0.3)" strokeWidth="2" />
            <text x="100" y="90" textAnchor="middle" fill="rgba(102, 126, 234, 0.5)" fontSize="40" fontWeight="bold">?</text>
            <circle cx="50" cy="40" r="8" fill="rgba(118, 75, 162, 0.15)" />
            <circle cx="150" cy="120" r="6" fill="rgba(251, 191, 36, 0.15)" />
            <circle cx="160" cy="40" r="10" fill="rgba(16, 185, 129, 0.15)" />
        </svg>
    ),
    'search': (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" className="empty-state-illustration">
            <circle cx="85" cy="75" r="35" fill="rgba(102, 126, 234, 0.1)" stroke="rgba(102, 126, 234, 0.3)" strokeWidth="2" />
            <line x1="110" y1="100" x2="140" y2="130" stroke="rgba(102, 126, 234, 0.4)" strokeWidth="3" strokeLinecap="round" />
            <path d="M75 65v20M65 75h20" stroke="rgba(118, 75, 162, 0.4)" strokeWidth="2" strokeLinecap="round" />
        </svg>
    ),
};

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, message, action }) => (
    <div className="empty-state">
        <div className="empty-state-visual">
            {illustrations[icon] || (
                <div className="empty-state-icon">
                    <Icon name={icon} size={40} strokeWidth={1.5} />
                </div>
            )}
        </div>
        <h4 className="empty-state-title">{title}</h4>
        {message && <p className="empty-state-message">{message}</p>}
        {action && <div className="empty-state-action">{action}</div>}
    </div>
);

export default EmptyState;
