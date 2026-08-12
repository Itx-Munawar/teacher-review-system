import React from 'react';

interface LegalPageProps {
    title: string;
    updated?: string;
    children: React.ReactNode;
}

const LegalPage: React.FC<LegalPageProps> = ({ title, updated, children }) => (
    <div className="legal-page">
        <div className="legal-container">
            <a href="/" className="back-button">← Back to Home</a>
            <h1 className="gradient-text">{title}</h1>
            {updated && <p className="legal-updated">Last updated: {updated}</p>}
            <div className="legal-content">{children}</div>
        </div>
    </div>
);

export default LegalPage;
