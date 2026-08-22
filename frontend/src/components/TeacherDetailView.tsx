import React, { useState, useCallback, useRef } from 'react';
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
// Each click changes the net score by exactly 1:
//   - Click same vote → toggle off (score ±1)
//   - No current vote  → add vote  (score ±1)
//   - Switching votes  → remove old only (score ±1)
const VoteButtons: React.FC<{
    review: Review;
    showToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}> = ({ review, showToast }) => {
    const [votes, setVotes] = useState({
        upvotes: review.upvotes ?? 0,
        downvotes: review.downvotes ?? 0,
        userVote: 0 as 1 | -1 | 0,
    });
    // Use refs to avoid stale closures in async handlers
    const votesRef = useRef(votes);
    votesRef.current = votes;
    const busyRef = useRef(false);
    const [isBusy, setIsBusy] = useState(false);

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

    const handleVote = useCallback(async (newVote: 1 | -1) => {
        if (busyRef.current) return;
        const prev = votesRef.current;

        // Compute the next state — each path changes the score by exactly 1
        let nextUp = prev.upvotes;
        let nextDown = prev.downvotes;
        let nextUserVote: 0 | 1 | -1 = prev.userVote;
        let serverVote: 0 | 1 | -1;

        if (prev.userVote === newVote) {
            // Toggle off: click same vote again → remove it
            if (newVote === 1) nextUp = Math.max(0, prev.upvotes - 1);
            else nextDown = Math.max(0, prev.downvotes - 1);
            nextUserVote = 0;
            serverVote = 0;
        } else if (prev.userVote === 0) {
            // No current vote → add this one
            if (newVote === 1) nextUp = prev.upvotes + 1;
            else nextDown = prev.downvotes + 1;
            nextUserVote = newVote;
            serverVote = newVote;
        } else {
            // Switching from opposite → remove old only (don't add new yet)
            if (prev.userVote === 1) nextUp = Math.max(0, prev.upvotes - 1);
            else nextDown = Math.max(0, prev.downvotes - 1);
            nextUserVote = 0;
            serverVote = 0;
        }

        // Optimistic update — UI changes instantly
        setVotes({ upvotes: nextUp, downvotes: nextDown, userVote: nextUserVote });
        triggerPop(newVote === 1 ? 'up' : 'down');
        busyRef.current = true;
        setIsBusy(true);

        try {
            const res = await voteReview(review.id, serverVote);
            // Sync with server truth
            setVotes({
                upvotes: res.data.upvotes,
                downvotes: res.data.downvotes,
                userVote: res.data.userVote,
            });
        } catch (err) {
            // Revert optimistic update on failure
            setVotes(prev);
            console.error('Vote error:', err);
            const axiosErr = err as { response?: { data?: { error?: string } } };
            showToast(axiosErr.response?.data?.error || 'Failed to vote. Please try again.', 'error');
        } finally {
            busyRef.current = false;
            setIsBusy(false);
        }
    }, [review.id, showToast, triggerPop]);

    const netScore = votes.upvotes - votes.downvotes;

    return (
        <div className="review-votes">
            <button
                className={`vote-btn vote-up ${votes.userVote === 1 ? 'vote-active' : ''} ${upPop ? 'vote-pop vote-glow' : ''}`}
                onClick={() => handleVote(1)}
                disabled={isBusy}
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
                onClick={() => handleVote(-1)}
                disabled={isBusy}
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
}) => {
    const [reviewSort, setReviewSort] = useState<'newest' | 'helpful'>('newest');

    // Sort reviews based on selected sort option
    const sortedReviews = React.useMemo(() => {
        if (!selectedTeacher.reviews) return [];
        const reviews = [...selectedTeacher.reviews];
        if (reviewSort === 'helpful') {
            return reviews.sort((a, b) => {
                const scoreA = (a.upvotes ?? 0) - (a.downvotes ?? 0);
                const scoreB = (b.upvotes ?? 0) - (b.downvotes ?? 0);
                return scoreB - scoreA;
            });
        }
        return reviews.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }, [selectedTeacher.reviews, reviewSort]);

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
                <div className="review-sort-toggle">
                    <button
                        className={`sort-pill ${reviewSort === 'newest' ? 'sort-pill-active' : ''}`}
                        onClick={() => setReviewSort('newest')}
                    >
                        <Icon name="calendar" size={13} /> Newest
                    </button>
                    <button
                        className={`sort-pill ${reviewSort === 'helpful' ? 'sort-pill-active' : ''}`}
                        onClick={() => setReviewSort('helpful')}
                    >
                        <Icon name="star" size={13} /> Most Helpful
                    </button>
                </div>
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
};

export default TeacherDetailView;
