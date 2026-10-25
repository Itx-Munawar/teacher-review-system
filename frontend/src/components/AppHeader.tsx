import React from 'react';
import Icon from './Icon';

interface AppHeaderProps {
    showMobileMenu: boolean;
    setShowMobileMenu: React.Dispatch<React.SetStateAction<boolean>>;
    handleTabHome: () => void;
    handleTabAdmin: () => void;
    handleOpenQnA: () => void;
    setShowContactModal: (open: boolean) => void;
    setShowAboutModal: (open: boolean) => void;
}

/** Public site header: brand link, mobile menu toggle and header actions. */
const AppHeader: React.FC<AppHeaderProps> = ({ showMobileMenu, setShowMobileMenu, handleTabHome, handleTabAdmin, handleOpenQnA, setShowContactModal, setShowAboutModal }) => (
    <header className="header" role="banner">
        <div className="header-top">
            <a
                className="header-brand"
                href="/"
                onClick={(e) => { e.preventDefault(); handleTabHome(); }}
                title="Back to the start page"
                aria-label="UMT Teacher Reviews - go to start page"
            >
                <img
                    src={`${import.meta.env.BASE_URL}umt-logo.webp`}
                    alt="UMT Logo"
                    className="header-logo"
                    width={48}
                    height={48}
                    decoding="async"
                />
                <h1 style={{ margin: 0 }}>UMT Teacher Reviews</h1>
            </a>
            <button
                className={`menu-toggle${showMobileMenu ? ' menu-toggle-open' : ''}`}
                onClick={() => setShowMobileMenu(v => !v)}
                aria-expanded={showMobileMenu}
                aria-label={showMobileMenu ? 'Close menu' : 'Open menu'}
            >
                {showMobileMenu ? <Icon name="x" size={22} /> : <Icon name="menu" size={22} />}
            </button>
        </div>
        <p className="header-tagline">Reviews from UMT students, for UMT students.</p>
        <div className={`header-actions${showMobileMenu ? ' header-actions-open' : ''}`}>
            <button onClick={handleTabAdmin} className="admin-login-btn">
                <Icon name="lock" size={16} /> Admin login
            </button>
            <button onClick={handleOpenQnA} className="admin-login-btn">
                <Icon name="message-square" size={16} /> Q&amp;A
            </button>
            <button onClick={() => { setShowContactModal(true); setShowMobileMenu(false); }} className="admin-login-btn">
                <Icon name="mail" size={16} /> Contact us
            </button>
            <button onClick={() => { setShowAboutModal(true); setShowMobileMenu(false); }} className="admin-login-btn">
                <Icon name="info" size={16} /> About
            </button>
        </div>
    </header>
);

export default AppHeader;
