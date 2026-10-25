import React from 'react';

/** Site footer with legal links. */
const AppFooter: React.FC = () => (
    <footer className="app-footer" role="contentinfo">
        <div className="footer-content">
            <p>© {new Date().getFullYear()} UMT Teacher Reviews. All rights reserved.</p>
            <p className="footer-links">
                <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a> · <a href="/dmca">DMCA &amp; Content Removal</a> · <a href="/contact">Contact</a>
            </p>
            <p className="footer-disclaimer">All reviews are student opinions and not official university statements.</p>
        </div>
    </footer>
);

export default AppFooter;
