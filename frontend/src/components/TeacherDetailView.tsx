import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import LazySection from './LazySection';
import QASection from './QASection';
import { getTeacherSummary } from '../services/api';
import type { Teacher, TeacherDetail, Review } from '../types';

interface TeacherSummary {
    total: number;
    pros: string[];
    cons: string[];
    tagCounts: Record<string, number>;
    topTraits: { tag: string; count: number }[];
    sentimentScore: number;
    sentimentLabel: string;
    topicSentiment: Record<string, { positive: number; negative: number; label: string }>;
}

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
    const [summary, setSummary] = useState<TeacherSummary | null>(null);
    const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null);

    // Load summary
    useEffect(() => {
        if (selectedTeacher.reviews && selectedTeacher.reviews.length > 0) {
            getTeacherSummary(selectedTeacher.id)
                .then(res => setSummary(res.data))
                .catch(() => {});
        }
    }, [selectedTeacher.id, selectedTeacher.reviews]);

    // Sort reviews by newest first, optionally filter by tag
    const sortedReviews = React.useMemo(() => {
        if (!selectedTeacher.reviews) return [];
        let reviews = [...selectedTeacher.reviews].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
        if (activeTagFilter) {
            reviews = reviews.filter(r => r.tags?.includes(activeTagFilter));
        }
        return reviews;
    }, [selectedTeacher.reviews, activeTagFilter]);

    // Collect all unique tags from reviews
    const allTags = React.useMemo(() => {
        if (!selectedTeacher.reviews) return [];
        const tagSet = new Set<string>();
        selectedTeacher.reviews.forEach(r => r.tags?.forEach(t => tagSet.add(t)));
        return Array.from(tagSet);
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

        {/* AI Review Summary */}
        {summary && summary.total > 0 && (
            <LazySection
                className="review-summary-section"
                placeholder={<div className="review-summary-card" style={{ minHeight: '120px' }} />}
            >
                <div className="review-summary-card">
                    <h3><Icon name="star" size={18} /> Review Summary</h3>
                    <p className="summary-count">{summary.total} review{summary.total !== 1 ? 's' : ''} analyzed</p>

                    {/* Sentiment indicator */}
                    <div className="summary-sentiment">
                        <span className={`sentiment-badge sentiment-${summary.sentimentScore > 0.1 ? 'positive' : summary.sentimentScore < -0.1 ? 'negative' : 'mixed'}`}>
                            {summary.sentimentScore > 0.1 ? '😊' : summary.sentimentScore < -0.1 ? '😟' : '😐'} {summary.sentimentLabel}
                        </span>
                    </div>

                    {summary.topTraits.length > 0 && (
                        <div className="summary-traits">
                            <span className="summary-label">Top Traits:</span>
                            <div className="summary-trait-chips">
                                {summary.topTraits.map(({ tag, count }) => (
                                    <span key={tag} className="summary-trait-chip">
                                        {tag} <span className="trait-count">({count})</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="summary-columns">
                        {summary.pros.length > 0 && (
                            <div className="summary-pros">
                                <span className="summary-label pros-label"><Icon name="thumbs-up" size={14} /> Common Positives</span>
                                <ul>
                                    {summary.pros.map(p => <li key={p}>{p}</li>)}
                                </ul>
                            </div>
                        )}
                        {summary.cons.length > 0 && (
                            <div className="summary-cons">
                                <span className="summary-label cons-label"><Icon name="thumbs-down" size={14} /> Common Negatives</span>
                                <ul>
                                    {summary.cons.map(c => <li key={c}>{c}</li>)}
                                </ul>
                            </div>
                        )}
                    </div>

                    {/* Topic breakdown */}
                    {summary.topicSentiment && Object.keys(summary.topicSentiment).length > 0 && (
                        <div className="topic-sentiment">
                            <span className="summary-label">By Topic:</span>
                            <div className="topic-chips">
                                {Object.entries(summary.topicSentiment).map(([topic, data]) => (
                                    <span key={topic} className={`topic-chip topic-${data.label}`}>
                                        {topic === 'grading' ? '📊' : topic === 'teaching' ? '📖' : topic === 'attitude' ? '💬' : topic === 'recommendation' ? '👍' : '📌'}{' '}
                                        {topic.charAt(0).toUpperCase() + topic.slice(1)}
                                        <span className="topic-score"> {data.label}</span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </LazySection>
        )}

        <LazySection
            className="reviews-section"
            placeholder={<div className="reviews-section" style={{ minHeight: '80px' }} />}
        >
            <div className="reviews-header">
                <h3><Icon name="book-open" size={20} /> Student Reviews</h3>
            </div>

            {/* Tag Filter */}
            {allTags.length > 0 && (
                <div className="tag-filter-bar">
                    <button
                        className={`tag-chip tag-chip-filter ${activeTagFilter === null ? 'tag-chip-active' : ''}`}
                        onClick={() => setActiveTagFilter(null)}
                    >
                        All
                    </button>
                    {allTags.map(tag => (
                        <button
                            key={tag}
                            className={`tag-chip tag-chip-filter ${activeTagFilter === tag ? 'tag-chip-active' : ''}`}
                            onClick={() => setActiveTagFilter(activeTagFilter === tag ? null : tag)}
                        >
                            {tag}
                        </button>
                    ))}
                </div>
            )}

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
            ) : sortedReviews.length === 0 ? (
                <EmptyState
                    icon="search"
                    title="No reviews match this filter"
                    message="Try selecting a different tag."
                />
            ) : (
                sortedReviews.map((review: Review) => (
                    <div key={review.id} className="review-card">
                        <div className="review-header">
                            <span className="reviewer-name"><Icon name="user" size={13} /> {review.user_name || 'Anonymous'}</span>
                            <span className="review-date"><Icon name="calendar" size={13} /> {new Date(review.created_at).toLocaleDateString()}</span>
                        </div>
                        <p className="review-comment">"{review.comment}"</p>
                        {review.tags && review.tags.length > 0 && (
                            <div className="review-tags">
                                {review.tags.map(tag => (
                                    <span key={tag} className="review-tag">{tag}</span>
                                ))}
                            </div>
                        )}
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
