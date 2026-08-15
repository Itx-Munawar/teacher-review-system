import React from 'react';
import Icon, { IconName } from './Icon';

interface EmptyStateProps {
    icon: IconName;
    title: string;
    message?: string;
    action?: React.ReactNode;
}

const EmptyState: React.FC<EmptyStateProps> = ({ icon, title, message, action }) => (
    <div className="empty-state">
        <div className="empty-state-icon">
            <Icon name={icon} size={40} strokeWidth={1.5} />
        </div>
        <h4 className="empty-state-title">{title}</h4>
        {message && <p className="empty-state-message">{message}</p>}
        {action && <div className="empty-state-action">{action}</div>}
    </div>
);

export default EmptyState;
