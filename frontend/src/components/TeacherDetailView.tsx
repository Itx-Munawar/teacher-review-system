import React, { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import LazySection from './LazySection';
import QASection from './QASection';
import { voteReview } from '../services/api';
import type { Teacher, TeacherDetail, Review } from '../types';

interface TeacherDetailViewProps {
    selectedTeacher: TeacherDetail;
    relatedTeachers: Teacher[];
    reviewSuccess: string;
    reviewError: string;
    departments: { department: string; teacher_count: number }[];
    onShowReviewForm: () => void;
    onClearSelectedTeacher: () => void;
    onTeacherClick: (teacher: Teacher) => void;
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
}

// Inline vote buttons for a single review
const VoteButtons: React.FC<{
    review: Review;
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}> = ({ review, showToast }) => {
    const [votes, setVotes] = useState({
        upvotes: review.upvotes ?? 0,
        downvotes: review.downvotes ?? 0,
        userVote: 0 as 1 | -1 | 0,
    });
    const [loading, setLoading] = useState(false);
    const [upPop, setUpPop] = useState(false);
    const [downPop, setDownPop] = useState(false);
    const [scoreAnimate, setScoreAnimate] = useState(false);

    const triggerPop = useCallback((which: 'up' | 'down') => {
        if (which === 'up') {
            setUpPop(true);
            setTimeout(() => setUpPop(false), 380);
        } else {
            setDownPop(true);
            setTimeout(() => setDownPop(false), 380);
        }
        setScoreAnimate(true);
        setTimeout(() => setScoreAnimate(false), 320);
    }, []);

    const handleVote = useCallback(async (newVote: 1 | -1 | 0) => {
        if (loading) return;
        setLoading(true);
        try {
            const res = await voteReview(review.id, newVote);
            setVotes({
                upvotes: res.data.upvotes,
                downvotes: res.data.downvotes,
                userVote: res.data.userVote,
            });
            if (newVote === 1) triggerPop('up');
            else if (newVote === -1) triggerPop('down');
            else triggerPop(votes.userVote === 1 ? 'up' : 'down');
        } catch {
            showToast('Failed to vote. Please try again.', 'error');
        } finally {
            setLoading(false);
        }
    }, [review.id, loading, showToast, triggerPop, votes.userVote]);

    const netScore = votes.upvotes - votes.downvotes;

    return (
        <div className="review-votes">
            <button
                className={`vote-btn vote-up ${votes.userVote === 1 ? 'vote-active' : ''} ${upPop ? 'vote-pop vote-glow' : ''}`}
                onClick={() => handleVote(votes.userVote === 1 ? 0 : 1)}
                disabled={loading}
                aria-label="Upvote this review"
                title="Helpful"
            >
                ▲
            </button>
            <span className={`vote-score ${netScore > 0 ? 'vote-positive' : netScore < 0 ? 'vote-negative' : ''} ${scoreAnimate ? 'vote-score-animate' : ''}`}>
                {netScore > 0 ? '+' : ''}{netScore}
            </span>
            <button
                className={`vote-btn vote-down ${votes.userVote === -1 ? 'vote-active' : ''} ${downPop ? 'vote-pop vote-glow' : ''}`}
                onClick={() => handleVote(votes.userVote === -1 ? 0 : -1)}
                disabled={loading}
                aria-label="Downvote this review"
                title="Not helpful"
            >
                ▼
            </button>
        </div>
    );
};

const TeacherDetailView: React.FC<TeacherDetailViewProps> = ({
    selectedTeacher,
    relatedTeachers,
    reviewSuccess,
    reviewError,
    departments,
    onShowReviewForm,
    onClearSelectedTeacher,
    onTeacherClick,
    showToast,
}) => (
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
            <h3><Icon name="book-open" size={20} /> Student Reviews</h3>
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
                selectedTeacher.reviews.map((review: Review) => (
                    <div key={review.id} className="review-card">
                        <div className="review-header">
                            <span className="reviewer-name"><Icon name="user" size={13} /> {review.user_name || 'Anonymous'}</span>
                            <span className="review-date"><Icon name="calendar" size={13} /> {new Date(review.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="review-comment">"{review.comment}"</p>
                        <VoteButtons review={review} showToast={showToast} />
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

export default TeacherDetailView;
