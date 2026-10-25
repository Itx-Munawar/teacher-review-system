import React, { useEffect } from 'react';
import { applySeo } from '../utils/seo';
import { SITE_URL } from '../utils/siteUrl';

interface LegalPageProps {
    title: string;
    updated?: string;
    /** Used for the meta description; falls back to a generic sentence. */
    description?: string;
    children: React.ReactNode;
}

const LegalPage: React.FC<LegalPageProps> = ({ title, updated, description, children }) => {
    useEffect(() => {
        // These pages are separate routes, so App.tsx never runs for them and
        // they would otherwise keep the homepage canonical from index.html.
        const path = window.location.pathname.replace(/\/+$/, '') || '/';
        applySeo({
            title: `${title} | UMT Teacher Reviews`,
            description: description || `${title} for UMT Teacher Reviews.`,
            url: `${SITE_URL}${path}`,
        });
    }, [title, description]);

    return (
        <div className="legal-page">
            <div className="legal-container">
                <a href="/" className="back-button">← Back to Home</a>
                <h1 className="gradient-text">{title}</h1>
                {updated && <p className="legal-updated">Last updated: {updated}</p>}
                <div className="legal-content">{children}</div>
            </div>
        </div>
    );
};

export default LegalPage;
