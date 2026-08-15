import React from 'react';
import Icon, { IconName } from './Icon';

export interface BottomNavItem {
    key: string;
    label: string;
    icon: IconName;
    active?: boolean;
    onClick: () => void;
}

interface BottomNavProps {
    items: BottomNavItem[];
}

const BottomNav: React.FC<BottomNavProps> = ({ items }) => (
    <nav className="bottom-nav" aria-label="Primary navigation">
        <div className="bottom-nav-items">
            {items.map((item) => (
                <button
                    key={item.key}
                    type="button"
                    className={`bottom-nav-item${item.active ? ' bottom-nav-item-active' : ''}`}
                    onClick={item.onClick}
                    aria-current={item.active ? 'page' : undefined}
                >
                    <span className="bottom-nav-icon">
                        <Icon name={item.icon} size={22} />
                    </span>
                    <span className="bottom-nav-label">{item.label}</span>
                </button>
            ))}
        </div>
    </nav>
);

export default BottomNav;
