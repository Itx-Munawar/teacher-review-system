import React, { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import LazySection from './LazySection';
import QASection from './QASection';
import AiSummary from './AiSummary';
import { replyToReview, voteHelpful } from '../services/api';
import { extractCourses } from '../utils/courses';
import { SITE_URL } from '../utils/siteUrl';
import type { TeacherDetail, Teacher, Review, ReviewReply, ReviewQuery } from '../types';

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
    /** Re-fetch the reviews with another sort order or course filter. */
    onChangeReviewQuery?: (query: ReviewQuery) => void | Promise<void>;
    /** True while a new sort/filter is loading. */
    reviewQueryLoading?: boolean;
}

/** Copy text, falling back to a hidden textarea where the Clipboard API is missing. */
const copyText = async (text: string): Promise<boolean> => {
    try {
        if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return true;
        }
    } catch {
        // fall through to the legacy path
    }
    try {
        const el = document.createElement('textarea');
        el.value = text;
        el.setAttribute('readonly', '');
        el.style.position = 'fixed';
        el.style.opacity = '0';
        document.body.appendChild(el);
        el.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(el);
        return ok;
    } catch {
        return false;
    }
};

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
    onChangeReviewQuery,
    reviewQueryLoading = false,
}) => {
    const reviewSort = selectedTeacher.review_sort || 'helpful';
    const reviewCourse = selectedTeacher.review_course || null;
    // "Most helpful" keeps the server's order; otherwise newest first.
    const sortedReviews = useMemo(
        () => (reviewSort === 'helpful'
            ? [...(selectedTeacher.reviews || [])]
            : [...(selectedTeacher.reviews || [])].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())),
        [selectedTeacher.reviews, reviewSort]
    );
    const courseCounts = selectedTeacher.course_counts || [];

    // Distinct courses across reviews — a compact, honest profile fact.
    const courseCount = useMemo(() => {
        const courses = new Set<string>();
        (selectedTeacher.reviews || []).forEach((review) => {
            extractCourses(review).forEach((course) => courses.add(course.toLowerCase()));
        });
        return Math.max(courses.size, courseCounts.length);
    }, [selectedTeacher.reviews, courseCounts.length]);

    // Prefer the server's total: `reviews` now holds only the loaded page, so
    // its length must never shadow the real count on long profiles.
    const reviewCount = selectedTeacher.total_reviews || selectedTeacher.review_count || sortedReviews.length || 0;
    // With a course filter, paging follows the filtered total.
    const listTotal = reviewCourse
        ? (selectedTeacher.review_pagination?.total ?? selectedTeacher.filtered_reviews ?? sortedReviews.length)
        : reviewCount;
    const hasMoreReviews = typeof onLoadMoreReviews === 'function' && sortedReviews.length < listTotal;
    const canRefine = typeof onChangeReviewQuery === 'function' && reviewCount >= 2;
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

    // Helpful votes: optimistic local overrides on top of the server's data.
    const [votes, setVotes] = useState<Record<number, { voted: boolean; count: number }>>({});
    const [votingId, setVotingId] = useState<number | null>(null);
    useEffect(() => { setVotes({}); }, [selectedTeacher.id]);

    const toggleHelpful = async (review: Review) => {
        if (votingId !== null) return;
        const current = votes[review.id] || { voted: !!review.voted, count: review.helpful_count || 0 };
        const next = { voted: !current.voted, count: Math.max(0, current.count + (current.voted ? -1 : 1)) };
        setVotes((v) => ({ ...v, [review.id]: next }));
        setVotingId(review.id);
        try {
            const res = await voteHelpful(review.id, next.voted);
            const data = res.data as { voted: boolean; helpful_count: number };
            setVotes((v) => ({ ...v, [review.id]: { voted: data.voted, count: data.helpful_count } }));
        } catch (err) {
            setVotes((v) => ({ ...v, [review.id]: current }));
            const axiosErr = err as { response?: { data?: { error?: string } } };
            showToast(axiosErr.response?.data?.error || 'Could not save your vote. Please try again.', 'error');
        } finally {
            setVotingId(null);
        }
    };

    // Sharing: WhatsApp is where UMT students actually pass links around.
    const shareUrl = `${SITE_URL}/teacher/${selectedTeacher.id}`;
    const shareText = `${selectedTeacher.name}${selectedTeacher.department ? ` (${selectedTeacher.department})` : ''} ke baare mein students ke reviews dekho:`;
    const whatsappHref = `https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`;
    const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

    const handleCopyLink = async () => {
        const ok = await copyText(shareUrl);
        showToast(ok ? 'Link copied' : 'Could not copy the link', ok ? 'success' : 'error');
    };

    const handleNativeShare = async () => {
        try {
            await navigator.share({ title: `${selectedTeacher.name} – UMT Teacher Reviews`, text: shareText, url: shareUrl });
        } catch {
            // The visitor closed the share sheet.
        }
    };

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

                    <div className="profile-share" aria-label="Share this teacher">
                        <a
                            className="share-btn share-btn-whatsapp"
                            href={whatsappHref}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
                                <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.79-1.47-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.48.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35zM12.04 21.5h-.01a9.45 9.45 0 0 1-4.82-1.32l-.35-.2-3.58.94.96-3.49-.23-.36a9.43 9.43 0 0 1-1.45-5.03c0-5.22 4.25-9.46 9.48-9.46a9.4 9.4 0 0 1 6.7 2.78 9.4 9.4 0 0 1 2.77 6.7c0 5.22-4.25 9.46-9.47 9.46zm8.06-17.52A11.32 11.32 0 0 0 12.04.64C5.76.64.65 5.75.65 12.03c0 2 .52 3.96 1.52 5.69L.55 23.64l6.05-1.59a11.37 11.37 0 0 0 5.43 1.38h.01c6.28 0 11.39-5.11 11.39-11.39 0-3.04-1.18-5.9-3.33-8.06z" />
                            </svg>
                            WhatsApp
                        </a>
                        <button type="button" className="share-btn" onClick={handleCopyLink}>
                            <Icon name="link" size={14} /> Copy link
                        </button>
                        {canNativeShare && (
                            <button type="button" className="share-btn" onClick={handleNativeShare}>
                                <Icon name="share" size={14} /> Share
                            </button>
                        )}
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
                        <span className="section-pill">
                            {reviewCourse ? `${listTotal} of ${reviewCount}` : reviewCount} {reviewCount === 1 ? 'review' : 'reviews'}
                        </span>
                    </div>
                    <p className="moderation-note">Every review is read by a moderator before it appears.</p>

                    <AiSummary teacherId={selectedTeacher.id} reviewCount={reviewCount} />

                    {canRefine && (
                        <div className="review-toolbar">
                            {courseCounts.length > 0 && (
                                <div className="review-course-filter" role="group" aria-label="Filter reviews by course">
                                    <button
                                        type="button"
                                        className={`course-chip${!reviewCourse ? ' active' : ''}`}
                                        aria-pressed={!reviewCourse}
                                        onClick={() => reviewCourse && onChangeReviewQuery?.({ sort: reviewSort, course: null })}
                                    >
                                        Sab courses
                                    </button>
                                    {courseCounts.map(({ course, count }) => (
                                        <button
                                            key={course}
                                            type="button"
                                            className={`course-chip${reviewCourse === course ? ' active' : ''}`}
                                            aria-pressed={reviewCourse === course}
                                            onClick={() => onChangeReviewQuery?.({ sort: reviewSort, course: reviewCourse === course ? null : course })}
                                        >
                                            {course} <span className="course-chip-count">{count}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            <label className="review-sort">
                                <span>Sort</span>
                                <select
                                    value={reviewSort}
                                    onChange={(e) => onChangeReviewQuery?.({ sort: e.target.value === 'helpful' ? 'helpful' : 'newest', course: reviewCourse })}
                                    aria-label="Sort reviews"
                                >
                                    <option value="helpful">Most helpful</option>
                                    <option value="newest">Newest</option>
                                </select>
                            </label>
                        </div>
                    )}

                    <div className={`review-list${reviewQueryLoading ? ' review-list-loading' : ''}`} aria-busy={reviewQueryLoading}>
                    {sortedReviews.length === 0 && reviewCourse ? (
                        <div className="reviews-empty">
                            <p className="reviews-empty-title">Is course ka koi review nahi mila</p>
                            <button type="button" className="profile-cta profile-cta-small" onClick={() => onChangeReviewQuery?.({ sort: reviewSort, course: null })}>
                                Sab reviews dekhein
                            </button>
                        </div>
                    ) : sortedReviews.length === 0 ? (
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
                                        {(() => {
                                            const vote = votes[review.id] || { voted: !!review.voted, count: review.helpful_count || 0 };
                                            return (
                                                <button
                                                    type="button"
                                                    className={`review-helpful${vote.voted ? ' voted' : ''}`}
                                                    onClick={() => toggleHelpful(review)}
                                                    aria-pressed={vote.voted}
                                                    disabled={votingId === review.id}
                                                    title={vote.voted ? 'Remove your helpful vote' : 'Kya yeh review madadgar tha?'}
                                                >
                                                    <Icon name="thumbs-up" size={13} filled={vote.voted} /> Helpful
                                                    {vote.count > 0 && <span className="review-helpful-count">{vote.count}</span>}
                                                </button>
                                            );
                                        })()}
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
                                        : `Load more reviews (${listTotal - sortedReviews.length} remaining)`}
                                </button>
                            )}
                        </>
                    )}
                    </div>
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
