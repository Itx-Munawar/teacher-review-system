import React from 'react';
import LegalPage from './LegalPage';

const TermsOfUse: React.FC = () => (
    <LegalPage title="Terms of Use" updated="August 11, 2026">
        <h2>1. Acceptance of Terms</h2>
        <p>
            By accessing or using UMT Teacher Reviews (the "Site"), you agree to these Terms of Use. If
            you do not agree, please do not use the Site.
        </p>

        <h2>2. Nature of Content</h2>
        <p>
            The Site is an independent, student-made platform. It is <strong>not</strong> an official
            website of the University of Management and Technology (UMT) and is not endorsed by the
            university.
        </p>
        <p>
            All reviews are the opinions of individual students and do not reflect the views of UMT
            Teacher Reviews or its operators.
        </p>

        <h2>3. Acceptable Use</h2>
        <p>When using the Site, you agree NOT to:</p>
        <ul>
            <li>Post reviews containing harassment, hate speech, threats, or defamation.</li>
            <li>Post false, misleading, or fabricated information.</li>
            <li>Share personal contact details (phone numbers, emails, addresses) of any person.</li>
            <li>Attempt to spam, overload, or disrupt the Site.</li>
            <li>Attempt to access admin functionality or other users' data without authorization.</li>
        </ul>

        <h2>4. Reviews Are Moderated</h2>
        <p>
            We may review, edit, or remove any content at our discretion, including content that
            violates these Terms. Reviews that are clearly abusive, unsubstantiated, or contain
            personal information may be removed.
        </p>

        <h2>5. Disclaimer</h2>
        <p>
            The Site and its content are provided "as is" without warranties of any kind, express or
            implied. We do not guarantee the accuracy, completeness, or usefulness of any review.
        </p>

        <h2>6. Limitation of Liability</h2>
        <p>
            To the fullest extent permitted by law, UMT Teacher Reviews and its operators shall not be
            liable for any damages arising from your use of the Site, reliance on reviews, or any
            content posted by users.
        </p>

        <h2>7. Changes to These Terms</h2>
        <p>
            We may update these Terms from time to time. Continued use of the Site after changes are
            posted constitutes acceptance of the updated Terms.
        </p>

        <h2>8. Contact</h2>
        <p>
            Questions about these Terms can be sent to <strong>umt.teacher.reviews@gmail.com</strong>.
        </p>
    </LegalPage>
);

export default TermsOfUse;
