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
                <button className="back-button" onClick={onClearSelectedTeacher}>
                    <Icon name="chevron-left" size={16} /> Back to Teachers
                </button>

                {/* Always rendered: falls back to initials when there is no usable photo */}
                <Avatar
                    name={selectedTeacher.name}
                    imageUrl={selectedTeacher.image_url}
                    className="teacher-detail-image"
                    size={130}
                    priority
                />

                <div className="teacher-detail-header">
                    <h1>{selectedTeacher.name}</h1>
                    <p className="department-name">{selectedTeacher.department}</p>
                    <div className="review-count">
                        <Icon name="star" size={16} /> {selectedTeacher.review_count || selectedTeacher.total_reviews || 0} Reviews
                    </div>
                </div>

                {reviewSuccess && <div className="success-message">{reviewSuccess}</div>}
                {reviewError && <div className="error-message">{reviewError}</div>}

                <button className="btn-write-review" onClick={onShowReviewForm}>
                    <Icon name="edit" size={16} /> Write a Review
                </button>

                <div className="reviews-section">
                    <h2>Student Reviews</h2>
                    {sortedReviews.length === 0 ? (
                        <p className="no-reviews">No reviews yet. Be the first to share your experience!</p>
                    ) : (
                        sortedReviews.map((review: Review) => {
                            const courses = extractCourses(review);
                            return (
                                <div key={review.id} className="review-card">
                                    <div className="review-header">
                                        <span className="reviewer-name">
                                            <Icon name="user" size={13} /> {review.user_name || 'Anonymous'}
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
                                    <p className="review-comment">"{review.comment}"</p>
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
                                </div>
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
                    <h3>Related Teachers</h3>
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
