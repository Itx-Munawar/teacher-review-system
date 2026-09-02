import React from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import LazySection from './LazySection';
import QASection from './QASection';
import type { Teacher, TeacherDetail, Review } from '../types';

interface TeacherDetailViewProps {
    selectedTeacher: TeacherDetail;
    relatedTeachers: Teacher[];
    reviewSuccess: string;
    reviewError: string;
    onShowReviewForm: () => void;
    onClearSelectedTeacher: () => void;
    onTeacherClick: (teacher: Teacher) => void;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

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
    // Sort reviews by newest first
    const sortedReviews = React.useMemo(() => {
        if (!selectedTeacher.reviews) return [];
        return [...selectedTeacher.reviews].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
    }, [selectedTeacher.reviews]);

    return (
    <div className="teacher-detail page-enter">
        <button onClick={onClearSelectedTeacher} className="back-button">
            ← Back to list
        </button>

        <Avatar name={selectedTeacher.name || 'Teacher'} imageUrl={selectedTeacher.image_url} className="teacher-detail-image" />

        <h1 className="teacher-name-heading gradient-text">{selectedTeacher.name || 'Teacher'}</h1>
        <p className="teacher-department">
            <Link to={`/department/${encodeURIComponent(selectedTeacher.department || '')}`} className="department-link">
                {selectedTeacher.department || ''}
            </Link>
        </p>

        <button
            onClick={() => {
                const url = window.location.href;
                if (navigator.share) {
                    navigator.share({ title: `${selectedTeacher.name} - UMT Teacher Reviews`, url }).catch(() => {});
                } else {
                    navigator.clipboard.writeText(url).then(() => showToast('Link copied to clipboard!', 'success')).catch(() => {});
                }
            }}
            className="share-btn"
            aria-label={`Share ${selectedTeacher.name}`}
        >
            <Icon name="share" size={16} /> Share
        </button>

        {reviewSuccess && (
            <div className="success-message" role="status">
                {reviewSuccess}
            </div>
        )}

        {reviewError && (
            <div className="error-message">
                {reviewError}
            </div>
        )}

        <button onClick={onShowReviewForm} className="btn-write-review">
            <Icon name="edit" size={18} /> Write a Review for {selectedTeacher.name}
        </button>

        <LazySection
            className="reviews-section"
            placeholder={<div className="reviews-section" style={{ minHeight: '80px' }} />}
        >
            <div className="reviews-header">
                <h3><Icon name="book-open" size={20} /> Student Reviews</h3>
            </div>
            {!selectedTeacher.reviews || selectedTeacher.reviews.length === 0 ? (
                <EmptyState
                    icon="book-open"
                    title="No reviews yet"
                    message="Be the first to review this teacher!"
                    action={
                        <button onClick={onShowReviewForm} className="btn-write-review">
                            <Icon name="edit" size={16} /> Write a Review
                        </button>
                    }
                />
            ) : (
                sortedReviews.map((review: Review) => (
                    <div key={review.id} className="review-card">
                        <div className="review-header">
                            <span className="reviewer-name"><Icon name="user" size={13} /> {review.user_name || 'Anonymous'}</span>
                            <span className="review-date"><Icon name="calendar" size={13} /> {new Date(review.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="review-comment">"{review.comment}"</p>
                    </div>
                ))
            )}
        </LazySection>

        <LazySection
            className="qa-section-lazy"
            placeholder={<div className="qa-section" style={{ minHeight: '60px' }} />}
        >
            <QASection teacherId={selectedTeacher.id} teacherName={selectedTeacher.name || 'this teacher'} />
        </LazySection>

        {relatedTeachers.length > 0 && (
            <div className="related-teachers">
                <h3><Icon name="users" size={18} /> More teachers in {selectedTeacher.department}</h3>
                <div className="related-teachers-list">
                    {relatedTeachers.map((t) => (
                        <button key={t.id} onClick={() => onTeacherClick(t)} className="related-teacher-card">
                            <span className="related-teacher-name">{t.name}</span>
                            <span className="related-teacher-count">({t.review_count} reviews)</span>
                        </button>
                    ))}
                </div>
            </div>
        )}
    </div>
    );
};

export default TeacherDetailView;
