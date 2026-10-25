import React, { useState, useEffect } from 'react';
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

const CoursePage: React.FC = () => {
    const { name } = useParams<{ name: string }>();
    const course = decodeURIComponent(name || '');
    const [teachers, setTeachers] = useState<Teacher[]>([]);
    const [loading, setLoading] = useState(true);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loadingMore, setLoadingMore] = useState(false);

    // SEO: each course page gets its own title, description and canonical URL
    useEffect(() => {
        const baseUrl = SITE_URL;
        const title = `"${course}" Course Teachers | UMT Teacher Reviews`;
        const description = `Find teachers at UMT who have taught "${course}". Read anonymous student reviews.`;
        const url = `${baseUrl}/course/${encodeURIComponent(course)}`;
        applySeo({ title, description, url });
    }, [course]);

    const loadTeachers = async (pageNum: number) => {
        setLoading(pageNum === 1);
        try {
            const res = await getTeachers(pageNum, 'name', undefined, 200, course);
            if (pageNum === 1) {
                setTeachers(res.data.teachers || []);
                setTotal(res.data.pagination?.total || 0);
                setTotalPages(res.data.pagination?.totalPages || 1);
            } else {
                setTeachers(prev => [...prev, ...(res.data.teachers || [])]);
                setTotalPages(res.data.pagination?.totalPages || 1);
            }
        } catch {
            if (pageNum === 1) {
                setTeachers([]);
                setTotal(0);
            }
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    useEffect(() => {
        setPage(1);
        loadTeachers(1);
    }, [course]);

    const handleLoadMore = async () => {
        const nextPage = page + 1;
        if (nextPage > totalPages || loadingMore) return;
        setLoadingMore(true);
        await loadTeachers(nextPage);
    };

    return (
        <div className="app">
            <header className="header">
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '15px', flexWrap: 'wrap' }}>
                    <Link to="/" className="admin-login-btn" style={{ textDecoration: 'none' }}>
                        ← Back to Home
                    </Link>
                    <h1 style={{ margin: 0 }} className="dept-page-title">"{course}" Teachers</h1>
                </div>
                <p>{total} teacher{total !== 1 ? 's' : ''} in this course at UMT</p>
            </header>

            <div className="container">
                <div className="teacher-list" style={{ maxWidth: '720px', margin: '0 auto', width: '100%' }}>
                    {loading ? (
                        <>
                            {[...Array(6)].map((_, t) => (
                                <TeacherCardSkeleton key={t} />
                            ))}
                        </>
                    ) : teachers.length === 0 ? (
                        <div className="no-results">
                            No teachers found for course "{course}".
                            <br />
                            <Link to="/">Browse all teachers →</Link>
                        </div>
                    ) : (
                        <>
                            {teachers.map((teacher, t) => (
                                <div
                                    key={teacher.id}
                                    className="teacher-card-enter"
                                    style={{ animationDelay: `${Math.min(0.06 * t, 0.6)}s` }}
                                >
                                    <TiltCard className="teacher-card" maxTilt={6}>
                                        <Link
                                            to={`/teacher/${teacher.id}`}
                                            style={{ display: 'contents' }}
                                            aria-label={`View reviews for ${teacher.name}`}
                                        >
                                            <Avatar
                                                name={teacher.name}
                                                imageUrl={teacher.image_url}
                                                className="teacher-card-image"
                                                priority={t < 6}
                                            />
                                            <div className="teacher-card-info">
                                                <h3 title={teacher.name}>{teacher.name}</h3>
                                                <p className="department" title={teacher.department}>{teacher.department}</p>
                                                <span className="reviews-count">
                                                    ({teacher.review_count} {teacher.review_count === 1 ? 'review' : 'reviews'})
                                                </span>
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

export default CoursePage;
