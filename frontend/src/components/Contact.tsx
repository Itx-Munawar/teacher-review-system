import React from 'react';
import LegalPage from './LegalPage';

const Contact: React.FC = () => (
    <LegalPage
        title="Contact"
        description="Contact UMT Teacher Reviews about a review, a correction, or the site itself."
    >
        <h2>Email</h2>
        <p>
            The fastest way to reach the operator is email:{' '}
            <a href="mailto:umt.teacher.reviews@gmail.com">umt.teacher.reviews@gmail.com</a>.
        </p>

        <h2>What to include</h2>
        <ul>
            <li>The teacher's name and a link to their page, if you have one.</li>
            <li>The review text you are asking about (a screenshot is fine).</li>
            <li>What you want changed or removed, and why.</li>
        </ul>

        <h2>Removal and copyright requests</h2>
        <p>
            Review removal requests, including defamation and privacy complaints, follow the
            process on our <a href="/dmca">DMCA &amp; Content Removal Policy</a>. Copyright
            notices go to the same address.
        </p>

        <h2>Response time</h2>
        <p>
            We aim to reply within 5 business days. Abuse reports are prioritised over general
            questions.
        </p>
    </LegalPage>
);

export default Contact;
