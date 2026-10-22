import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import LazySection from './LazySection';
import QASection from './QASection';
import { reportReview } from '../services/api';
import type { TeacherDetail, Teacher, Review } from '../types';

interface TeacherDetailViewProps {
    selectedTeacher: TeacherDetail;
    relatedTeachers: Teacher[];
    reviewSuccess?: string;
    reviewError?: string;
    onShowReviewForm: () => void;
    onClearSelectedTeacher: () => void;
    onTeacherClick: (teacher: Teacher) => Promise<void>;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

/** Extract course names from review — handles string, array, Buffer, double-encoded JSON */
const extractCourses = (review: Review): string[] => {
    const raw = (review as any).courses || (review as any).course;
    if (!raw) return [];
    try {
        // Buffer → convert to string first
        const str = typeof raw === 'object' && raw.type === 'Buffer'
            ? Buffer.from(raw.data).toString('utf8')
            : String(raw);
        if (!str || str === 'null' || str === '[]') return [];
        const parsed = JSON.parse(str);
        const list = Array.isArray(parsed) ? parsed : [parsed];
        return list
            .map((c: unknown) => String(c).trim())
            .filter((c: string) => c.length > 0);
    } catch {
        // If JSON.parse fails, treat the raw value as a single course name
        const fallback = String(raw).trim();
        return fallback && fallback !== 'null' ? [fallback] : [];
    }
};

const TeacherDetailView: React.FC<TeacherDetailViewProps> = ({
    selectedTeacher,
    relatedTeachers,
    reviewSuccess,
    reviewError,
    onShowReviewForm,
    onClearSelectedTeacher,
    onTeacherClick,
    showToast,
}) => {
    const sortedReviews = useMemo(
        () => [...(selectedTeacher.reviews || [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
        [selectedTeacher.reviews]
    );

    // Distinct courses across reviews — a compact, honest profile fact.
    const courseCount = useMemo(() => {
        const courses = new Set<string>();
        (selectedTeacher.reviews || []).forEach((review) => {
            extractCourses(review).forEach((course) => courses.add(course.toLowerCase()));
        });
        return courses.size;
    }, [selectedTeacher.reviews]);

    const reviewCount = sortedReviews.length || selectedTeacher.review_count || selectedTeacher.total_reviews || 0;
    const latestReview = sortedReviews[0]?.created_at
        ? new Date(sortedReviews[0].created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
        : '—';

    // Reader reports: one inline form at a time, and a local record of what
    // this session already reported so the button does not invite doubles.
    const [reportOpenId, setReportOpenId] = useState<number | null>(null);
    const [reportReason, setReportReason] = useState('');
    const [reportSending, setReportSending] = useState(false);
    const [reportedIds, setReportedIds] = useState<number[]>([]);

    const submitReport = async (e: React.FormEvent, reviewId: number) => {
        e.preventDefault();
        const reason = reportReason.trim();
        if (reason.length < 3 || reportSending) return;
        setReportSending(true);
        try {
            await reportReview(reviewId, reason);
            setReportedIds((ids) => [...ids, reviewId]);
            setReportOpenId(null);
            setReportReason('');
            showToast('Report sent. Thank you - a moderator will take a look.', 'success');
        } catch (err) {
            const axiosErr = err as { response?: { data?: { error?: string } } };
            showToast(axiosErr.response?.data?.error || 'Could not send the report. Please try again.', 'error');
        } finally {
            setReportSending(false);
        }
    };

    return (
        <>
        <LazySection
            className="teacher-detail-lazy"
            placeholder={
                <div style={{ padding: '40px 0', textAlign: 'center' }}>
                    <div className="spinner" style={{ margin: '0 auto' }}></div>
                </div>
            }
        >
            <div className="teacher-detail">
                <div className="profile-topbar">
                    <button className="back-button" onClick={onClearSelectedTeacher}>
                        <Icon name="chevron-left" size={16} /> Back to teachers
                    </button>
                    <span className="profile-topbar-note">Anonymous student reviews</span>
                </div>

                <header className="profile-hero">
                    <div className="profile-hero-row">
                        {/* Always rendered: falls back to initials when there is no usable photo */}
                        <Avatar
                            name={selectedTeacher.name}
                            imageUrl={selectedTeacher.image_url}
                            className="teacher-detail-image"
                            size={116}
                            priority
                        />
                        <div className="profile-hero-main">
                            <p className="profile-eyebrow">{selectedTeacher.department || 'UMT Faculty'}</p>
                            <h1>{selectedTeacher.name}</h1>
                        </div>
                        <div className="profile-hero-actions">
                            <button className="btn-write-review profile-cta" onClick={onShowReviewForm}>
                                <Icon name="edit" size={16} /> Write a review
                            </button>
                            <span className="profile-cta-note">Anonymous by default</span>
                        </div>
                    </div>

                    <div className="profile-stats">
                        <div className="profile-stat">
                            <span className="profile-stat-value">{reviewCount}</span>
                            <span className="profile-stat-label">{reviewCount === 1 ? 'Review' : 'Reviews'}</span>
                        </div>
                        <div className="profile-stat">
                            <span className="profile-stat-value">{courseCount}</span>
                            <span className="profile-stat-label">{courseCount === 1 ? 'Course' : 'Courses'}</span>
                        </div>
                        <div className="profile-stat">
                            <span className="profile-stat-value profile-stat-date">{latestReview}</span>
                            <span className="profile-stat-label">Latest review</span>
                        </div>
                    </div>
                </header>

                {reviewSuccess && <div className="success-message">{reviewSuccess}</div>}
                {reviewError && <div className="error-message">{reviewError}</div>}

                <div className="reviews-section">
                    <div className="section-head">
                        <div>
                            <p className="section-eyebrow">What students say</p>
                            <h2>Student reviews</h2>
                        </div>
                        <span className="section-pill">{reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}</span>
                    </div>
                    <p className="moderation-note">Every review is read by a moderator before it appears.</p>
                    {sortedReviews.length === 0 ? (
                        <div className="reviews-empty">
                            <p className="reviews-empty-title">No reviews yet</p>
                            <p className="reviews-empty-text">If you took this class, yours can be the first.</p>
                            <button type="button" className="profile-cta profile-cta-small" onClick={onShowReviewForm}>
                                <Icon name="edit" size={15} /> Write the first review
                            </button>
                        </div>
                    ) : (
                        sortedReviews.map((review: Review) => {
                            const courses = extractCourses(review);
                            return (
                                <article key={review.id} className="review-card">
                                    <div className="review-header">
                                        <span className="reviewer-badge" aria-hidden="true">
                                            {(review.user_name || 'A').trim().charAt(0).toUpperCase()}
                                        </span>
                                        <span className="reviewer-name">
                                            {review.user_name || 'Anonymous'}
                                        </span>
                                        <span className="review-date">
                                            <Icon name="calendar" size={13} /> {new Date(review.created_at).toLocaleDateString()}
                                        </span>
                                    </div>
                                    {courses.length > 0 && (
                                        <div className="review-courses">
                                            {courses.map((c, i) => (
                                                <span key={i} className="review-course">
                                                    <Icon name="book-open" size={11} /> {c}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    <p className="review-comment">{review.comment}</p>
                                    <div className="review-footer">
                                        {reportedIds.includes(review.id) ? (
                                            <span className="review-reported">
                                                <Icon name="check" size={12} /> Reported — thank you
                                            </span>
                                        ) : reportOpenId === review.id ? (
                                            <form
                                                className="review-report-form"
                                                onSubmit={(e) => submitReport(e, review.id)}
                                            >
                                                <input
                                                    type="text"
                                                    value={reportReason}
                                                    onChange={(e) => setReportReason(e.target.value)}
                                                    placeholder="Why are you reporting this review?"
                                                    maxLength={300}
                                                    aria-label="Reason for reporting this review"
                                                    autoFocus
                                                />
                                                <button
                                                    type="submit"
                                                    className="review-report-send"
                                                    disabled={reportSending || reportReason.trim().length < 3}
                                                >
                                                    {reportSending ? 'Sending…' : 'Send'}
                                                </button>
                                                <button
                                                    type="button"
                                                    className="review-report-cancel"
                                                    onClick={() => { setReportOpenId(null); setReportReason(''); }}
                                                >
                                                    Cancel
                                                </button>
                                            </form>
                                        ) : (
                                            <button
                                                type="button"
                                                className="review-report-trigger"
                                                onClick={() => { setReportOpenId(review.id); setReportReason(''); }}
                                                aria-label={`Report this review by ${review.user_name || 'Anonymous'}`}
                                            >
                                                <Icon name="flag" size={12} /> Report
                                            </button>
                                        )}
                                    </div>
                                </article>
                            );
                        })
                    )}
                </div>
            </div>
        </LazySection>

        <LazySection
            className="qa-section-lazy"
            placeholder={<div className="qa-section" style={{ minHeight: '60px' }} />}
        >
            <QASection teacherId={selectedTeacher.id} teacherName={selectedTeacher.name || 'this teacher'} />
        </LazySection>

        {relatedTeachers.length > 0 && (
            <LazySection
                className="related-teachers-lazy"
                placeholder={<div className="related-teachers" style={{ minHeight: '60px' }} />}
            >
                <div className="related-teachers">
                    <div className="section-head">
                        <div>
                            <p className="section-eyebrow">Keep exploring</p>
                            <h3>Related teachers</h3>
                        </div>
                    </div>
                    <div className="related-teachers-list">
                        {relatedTeachers.map((teacher) => (
                            <button
                                key={teacher.id}
                                className="related-teacher-card"
                                onClick={() => onTeacherClick(teacher)}
                            >
                                <span className="related-teacher-name">{teacher.name}</span>
                                <span className="related-teacher-dept">{teacher.department}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </LazySection>
        )}
        </>
    );
};

export default TeacherDetailView;
