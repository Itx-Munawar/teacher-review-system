import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getTeachers } from '../services/api';
import TiltCard from './TiltCard';

interface Teacher {
    id: number;
    name: string;
    department: string;
    review_count: number;
    image_url?: string;
}

const DepartmentPage: React.FC = () => {
    const { name } = useParams<{ name: string }>();
    const department = decodeURIComponent(name || '');
    const [teachers, setTeachers] = useState<Teacher[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);

    useEffect(() => {
        const baseUrl = 'https://teacher-review-system-zeta.vercel.app';
        const title = `${department} Teachers | UMT Teacher Reviews`;
        const description = `Browse ${department} teachers at UMT Lahore. Read anonymous student reviews and find the best professors.`;
        const url = `${baseUrl}/department/${encodeURIComponent(department)}`;

        document.title = title;
        const metaDesc = document.querySelector('meta[name="description"]');
        const ogTitle = document.querySelector('meta[property="og:title"]');
        const ogDesc = document.querySelector('meta[property="og:description"]');
        const ogUrl = document.querySelector('meta[property="og:url"]');
        const canonical = document.querySelector('link[rel="canonical"]');
        if (metaDesc) metaDesc.setAttribute('content', description);
        if (ogTitle) ogTitle.setAttribute('content', title);
        if (ogDesc) ogDesc.setAttribute('content', description);
        if (ogUrl) ogUrl.setAttribute('content', url);
        if (canonical) canonical.setAttribute('href', url);

        let cancelled = false;
        setLoading(true);
        getTeachers(1, 'name', department).then((res) => {
            if (cancelled) return;
            setTeachers(res.data.teachers || []);
            setTotal(res.data.pagination?.total || 0);
        }).catch(() => {
            if (!cancelled) setTeachers([]);
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [department]);

    return (
        <div className="app">
            <header className="header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '15px', flexWrap: 'wrap' }}>
                    <img src="https://www.umt.edu.pk/images/umt-logo.png" alt="UMT Logo" style={{ height: '60px', width: 'auto' }} />
                    <h1 style={{ margin: 0 }}>{department} Teachers</h1>
                </div>
                <p>{total} teachers in this department at UMT</p>
                <Link to="/" className="admin-login-btn">← Back to Home</Link>
            </header>
            <div className="container">
                <div className="teacher-list" style={{ maxWidth: '720px', margin: '0 auto', width: '100%' }}>
                    {loading ? (
                        <div className="loading">Loading teachers...</div>
                    ) : teachers.length === 0 ? (
                        <div className="no-results">No teachers found in this department.</div>
                    ) : (
                        <>
                            {teachers.map((teacher: Teacher) => (
                                <div key={teacher.id} className="teacher-card-enter">
                                    <TiltCard className="teacher-card">
                                        <Link to={`/teacher/${teacher.id}`} style={{ display: 'flex', alignItems: 'center', gap: '15px', textDecoration: 'none', color: 'inherit', padding: '10px' }}>
                                            {teacher.image_url && (
                                                <div className="teacher-card-image">
                                                    <img src={teacher.image_url} alt={teacher.name} loading="lazy" />
                                                </div>
                                            )}
                                            <div className="teacher-card-info">
                                                <h3>{teacher.name}</h3>
                                                <p className="department">{teacher.department}</p>
                                                <span className="reviews-count">({teacher.review_count} reviews)</span>
                                            </div>
                                        </Link>
                                    </TiltCard>
                                </div>
                            ))}
                        </>
                    )}
                </div>
            </div>
            <footer className="app-footer">
                <div className="footer-content">
                    <p>© {new Date().getFullYear()} UMT Teacher Reviews. All rights reserved.</p>
                    <p className="footer-links">
                        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a> · <a href="/dmca">DMCA &amp; Content Removal</a>
                    </p>
                </div>
            </footer>
        </div>
    );
};

export default DepartmentPage;
