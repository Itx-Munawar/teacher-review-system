import React, { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getTeachers } from '../services/api';
import TiltCard from './TiltCard';
import Avatar from './Avatar';
import { TeacherCardSkeleton } from './Skeleton';
import { SITE_URL } from '../utils/siteUrl';
import { applySeo } from '../utils/seo';

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
    const [loadingMore, setLoadingMore] = useState(false);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    // Bumped whenever the department changes so a slow "load more" for the old
    // department cannot append its rows to the new one.
    const loadGeneration = useRef(0);

    useEffect(() => {
        const baseUrl = SITE_URL;
        const title = `${department} Teachers | UMT Teacher Reviews`;
        const description = `Browse ${department} teachers at UMT Lahore. Read anonymous student reviews and find the best professors.`;
        const url = `${baseUrl}/department/${encodeURIComponent(department)}`;

        applySeo({ title, description, url });

        let cancelled = false;
        loadGeneration.current += 1;
        setLoading(true);
        setPage(1);
        getTeachers(1, 'name', department).then((res) => {
            if (cancelled) return;
            setTeachers(res.data.teachers || []);
            setTotal(res.data.pagination?.total || 0);
            setTotalPages(res.data.pagination?.totalPages || 1);
        }).catch(() => {
            if (!cancelled) {
                setTeachers([]);
                setTotal(0);
                setTotalPages(1);
            }
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => { cancelled = true; };
    }, [department]);

    // An empty result usually means the department name in the URL is wrong
    // (or the department was renamed), so keep the soft-404 out of the index.
    useEffect(() => {
        if (loading) return;
        const robots = document.head.querySelector('meta[name="robots"]');
        if (robots) {
            robots.setAttribute('content', teachers.length === 0 ? 'noindex, nofollow' : 'index, follow');
        }
    }, [loading, teachers.length]);

    // The API pages at 20 rows by default; the largest department has ~290
    // teachers, so the first page alone used to hide most of it.
    const handleLoadMore = async () => {
        const nextPage = page + 1;
        const generation = loadGeneration.current;
        setLoadingMore(true);
        try {
            const res = await getTeachers(nextPage, 'name', department);
            if (generation !== loadGeneration.current) return;
            setTeachers((prev) => [...prev, ...(res.data.teachers || [])]);
            setPage(nextPage);
            setTotalPages(res.data.pagination?.totalPages || nextPage);
            setTotal(res.data.pagination?.total ?? total);
        } catch {
            // Keep what is already on screen; the button stays available.
        } finally {
            setLoadingMore(false);
        }
    };

    return (
        <div className="app">
            <header className="header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '15px', flexWrap: 'wrap' }}>
                    <img
                        src={`${import.meta.env.BASE_URL}umt-logo.webp`}
                        alt="UMT Logo"
                        width={60}
                        height={57}
                        decoding="async"
                        style={{ height: '60px', width: 'auto' }}
                    />
                    <h1 style={{ margin: 0 }} className="dept-page-title">{department} Teachers</h1>
                </div>
                <p>{total} teacher{total !== 1 ? 's' : ''} in this department at UMT</p>
                <Link to="/" className="admin-login-btn">← Back to Home</Link>
            </header>
            <div className="container">
                <div className="teacher-list" style={{ maxWidth: '720px', margin: '0 auto', width: '100%' }}>
                    {loading ? (
                        <>
                            {Array.from({ length: 6 }).map((_, i) => <TeacherCardSkeleton key={i} />)}
                        </>
                    ) : teachers.length === 0 ? (
                        <div className="no-results">No teachers found in this department.</div>
                    ) : (
                        <>
                            {teachers.map((teacher: Teacher, index: number) => (
                                <div
                                    key={teacher.id}
                                    className="teacher-card-enter"
                                    style={{ animationDelay: `${Math.min(index * 0.06, 0.6)}s` }}
                                >
                                    <TiltCard className="teacher-card">
                                        <Link
                                            to={`/teacher/${teacher.id}`}
                                            style={{ display: 'contents' }}
                                            aria-label={`View reviews for ${teacher.name}`}
                                        >
                                            <Avatar name={teacher.name} imageUrl={teacher.image_url} className="teacher-card-image" priority={index < 6} />
                                            <div className="teacher-card-info">
                                                <h3>{teacher.name}</h3>
                                                <p className="department">{teacher.department}</p>
                                                <span className="reviews-count">({teacher.review_count} {teacher.review_count === 1 ? 'review' : 'reviews'})</span>
                                            </div>
                                        </Link>
                                    </TiltCard>
                                </div>
                            ))}
                            {page < totalPages && (
                                <button
                                    type="button"
                                    className="load-more-btn"
                                    onClick={handleLoadMore}
                                    disabled={loadingMore}
                                    style={{ marginTop: '1rem', width: '100%' }}
                                >
                                    {loadingMore ? 'Loading…' : `Load more teachers (${teachers.length} of ${total})`}
                                </button>
                            )}
                        </>
                    )}
                </div>
            </div>
            <footer className="app-footer">
                <div className="footer-content">
                    <p>© {new Date().getFullYear()} UMT Teacher Reviews. All rights reserved.</p>
                    <p className="footer-links">
                        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a> · <a href="/dmca">DMCA &amp; Content Removal</a> · <a href="/contact">Contact</a>
                    </p>
                </div>
            </footer>
        </div>
    );
};

export default DepartmentPage;
