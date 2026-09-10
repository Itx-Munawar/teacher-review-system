import React, { useMemo } from 'react';
import Icon from './Icon';
import LazySection from './LazySection';
import QASection from './QASection';
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
            .map((c: any) => String(c).trim())
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

                {selectedTeacher.image_url && (
                    <img src={selectedTeacher.image_url} alt={selectedTeacher.name} className="teacher-detail-image" />
                )}

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
