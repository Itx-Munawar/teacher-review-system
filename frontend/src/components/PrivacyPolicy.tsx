import React from 'react';
import LegalPage from './LegalPage';

const PrivacyPolicy: React.FC = () => (
    <LegalPage title="Privacy Policy" updated="August 11, 2026">
        <h2>1. Overview</h2>
        <p>
            UMT Teacher Reviews ("we", "us", "our") respects your privacy. This Privacy Policy explains
            what information we collect when you use our website at teacher-review-system-zeta.vercel.app
            (the "Site") and how we use it.
        </p>

        <h2>2. Information You Provide</h2>
        <p>
            When you submit a review, you may optionally provide your name. Reviews can be posted
            anonymously. The name you provide (if any) and your review text are stored on our servers
            so they can be displayed to other visitors.
        </p>
        <p>
            We do <strong>not</strong> require registration, email addresses, or personal identification
            to leave a review.
        </p>

        <h2>3. Information Collected Automatically</h2>
        <p>
            Our servers automatically collect basic technical information such as IP addresses, browser
            type, and timestamps. This data is used for security (for example, rate limiting and
            preventing abuse) and is not sold or shared with third parties.
        </p>

        <h2>4. Cookies</h2>
        <p>
            The Site uses cookies only for admin authentication (a secure HttpOnly session cookie). We do
            not use tracking or advertising cookies.
        </p>

        <h2>5. How We Use Information</h2>
        <p>We use the information we collect to:</p>
        <ul>
            <li>Display the reviews and teacher information you see on the Site.</li>
            <li>Protect the Site against spam, abuse, and denial-of-service attacks.</li>
            <li>Maintain and improve the Site's functionality and performance.</li>
        </ul>

        <h2>6. Public Visibility</h2>
        <p>
            Any review you submit may be publicly displayed on the Site. Do not include personal
            contact information (such as phone numbers or email addresses) in your review text.
        </p>

        <h2>7. Data Retention</h2>
        <p>
            Reviews remain on the Site until removed by an administrator or through a removal request
            (see our <a href="/dmca">DMCA &amp; Removal Policy</a>).
        </p>

        <h2>8. Third-Party Services</h2>
        <p>
            The Site is hosted using third-party infrastructure providers (such as Vercel and Render).
            These providers process data as necessary to serve the Site and are bound by their own
            privacy policies.
        </p>

        <h2>9. Children's Privacy</h2>
        <p>
            The Site is not directed at children under 13 and we do not knowingly collect information
            from them.
        </p>

        <h2>10. Contact</h2>
        <p>
            If you have questions about this Privacy Policy or want a review removed, contact us at
            <strong> umt.teacher.reviews@gmail.com</strong>.
        </p>
    </LegalPage>
);

export default PrivacyPolicy;
