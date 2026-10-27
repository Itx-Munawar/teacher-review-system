import React, { useMemo, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import LazySection from './LazySection';
import QASection from './QASection';
import { replyToReview } from '../services/api';
import { extractCourses } from '../utils/courses';
import type { TeacherDetail, Teacher, Review, ReviewReply } from '../types';

interface TeacherDetailViewProps {
    selectedTeacher: TeacherDetail;
    relatedTeachers: Teacher[];
    reviewSuccess?: string;
    reviewError?: string;
    onShowReviewForm: () => void;
    onClearSelectedTeacher: () => void;
    onTeacherClick: (teacher: Teacher) => Promise<void>;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    /** True while an older page of reviews is being fetched. */
    reviewsLoading?: boolean;
    /** Load the next page of reviews for long profiles. */
    onLoadMoreReviews?: () => void | Promise<void>;
}

const REPLY_MIN = 2;
const REPLY_MAX = 500;

const TeacherDetailView: React.FC<TeacherDetailViewProps> = ({
    selectedTeacher,
    relatedTeachers,
    reviewSuccess,
    reviewError,
    onShowReviewForm,
    onClearSelectedTeacher,
    onTeacherClick,
    showToast,
    reviewsLoading = false,
    onLoadMoreReviews,
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

    // Prefer the server's total: `reviews` now holds only the loaded page, so
    // its length must never shadow the real count on long profiles.
    const reviewCount = selectedTeacher.total_reviews || selectedTeacher.review_count || sortedReviews.length || 0;
    const hasMoreReviews = typeof onLoadMoreReviews === 'function' && sortedReviews.length < reviewCount;
    const latestReview = sortedReviews[0]?.created_at
        ? new Date(sortedReviews[0].created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
        : '—';

    // Replies: one inline form at a time, and a local record of what this
    // session already sent so the reader sees it is waiting for approval.
    const [replyOpenId, setReplyOpenId] = useState<number | null>(null);
    const [replyText, setReplyText] = useState('');
    const [replyName, setReplyName] = useState('');
    const [replySending, setReplySending] = useState(false);
    const [repliedIds, setRepliedIds] = useState<number[]>([]);

    const closeReplyForm = () => {
        setReplyOpenId(null);
        setReplyText('');
    };

    const submitReply = async (e: React.FormEvent, reviewId: number) => {
        e.preventDefault();
        const text = replyText.trim();
        if (text.length < REPLY_MIN || replySending) return;
        setReplySending(true);
        try {
            await replyToReview(reviewId, text, replyName.trim() || undefined);
            setRepliedIds((ids) => [...ids, reviewId]);
            closeReplyForm();
            showToast('Reply sent. It will appear once a moderator approves it.', 'success');
        } catch (err) {
            const axiosErr = err as { response?: { data?: { error?: string } } };
            showToast(axiosErr.response?.data?.error || 'Could not send the reply. Please try again.', 'error');
        } finally {
            setReplySending(false);
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
                        <>
                            {sortedReviews.map((review: Review) => {
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
                                    {(review.replies || []).length > 0 && (
                                        <ul className="review-replies" aria-label={`Replies to ${review.user_name || 'Anonymous'}`}>
                                            {(review.replies || []).map((reply: ReviewReply) => (
                                                <li key={reply.id} className="review-reply">
                                                    <div className="review-reply-meta">
                                                        <Icon name="message-circle" size={12} />
                                                        <span className="review-reply-author">{reply.user_name || 'Anonymous'}</span>
                                                        <span>{new Date(reply.created_at).toLocaleDateString()}</span>
                                                    </div>
                                                    <p className="review-reply-text">{reply.reply}</p>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    <div className="review-footer">
                                        {repliedIds.includes(review.id) && replyOpenId !== review.id ? (
                                            <span className="review-replied">
                                                <Icon name="check" size={12} /> Reply sent — it will appear after approval
                                            </span>
                                        ) : replyOpenId === review.id ? (
                                            <form
                                                className="review-reply-form"
                                                onSubmit={(e) => submitReply(e, review.id)}
                                            >
                                                <textarea
                                                    value={replyText}
                                                    onChange={(e) => setReplyText(e.target.value)}
                                                    placeholder="Write a reply to this review…"
                                                    maxLength={REPLY_MAX}
                                                    rows={2}
                                                    aria-label={`Reply to the review by ${review.user_name || 'Anonymous'}`}
                                                    autoFocus
                                                />
                                                <div className="review-reply-row">
                                                    <input
                                                        type="text"
                                                        value={replyName}
                                                        onChange={(e) => setReplyName(e.target.value)}
                                                        placeholder="Name (optional)"
                                                        maxLength={100}
                                                        aria-label="Your name (optional)"
                                                    />
                                                    <button
                                                        type="submit"
                                                        className="review-reply-send"
                                                        disabled={replySending || replyText.trim().length < REPLY_MIN}
                                                    >
                                                        {replySending ? 'Sending…' : 'Send reply'}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="review-reply-cancel"
                                                        onClick={closeReplyForm}
                                                    >
                                                        Cancel
                                                    </button>
                                                    <span className="review-reply-hint">
                                                        {replyText.length}/{REPLY_MAX} · moderated
                                                    </span>
                                                </div>
                                            </form>
                                        ) : (
                                            <button
                                                type="button"
                                                className="review-reply-trigger"
                                                onClick={() => { setReplyOpenId(review.id); setReplyText(''); }}
                                                aria-label={`Reply to the review by ${review.user_name || 'Anonymous'}`}
                                            >
                                                <Icon name="message-circle" size={12} /> Reply
                                                {(review.replies || []).length > 0 ? ` (${(review.replies || []).length})` : ''}
                                            </button>
                                        )}
                                    </div>
                                </article>
                            );
                        })}
                            {hasMoreReviews && (
                                <button
                                    type="button"
                                    className="review-load-more"
                                    onClick={onLoadMoreReviews}
                                    disabled={reviewsLoading}
                                >
                                    {reviewsLoading
                                        ? 'Loading…'
                                        : `Load more reviews (${reviewCount - sortedReviews.length} remaining)`}
                                </button>
                            )}
                        </>
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
