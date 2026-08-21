import React, { useState, useRef, useEffect, useCallback } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import { timeAgo } from '../utils/timeAgo';
import type { TeacherDetail } from '../types';

interface SwipeableCardsProps {
    teachers: TeacherDetail[];
    onRemove: (id: number) => void;
    onTeacherClick: (teacher: TeacherDetail) => void;
}

const SwipeableCards: React.FC<SwipeableCardsProps> = ({
    teachers,
    onRemove,
    onTeacherClick,
}) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [dragOffset, setDragOffset] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const startXRef = useRef(0);
    const currentXRef = useRef(0);

    // Reset active index when teachers change
    useEffect(() => {
        if (activeIndex >= teachers.length) {
            setActiveIndex(Math.max(0, teachers.length - 1));
        }
    }, [teachers.length, activeIndex]);

    const handleTouchStart = useCallback((e: React.TouchEvent) => {
        startXRef.current = e.touches[0].clientX;
        currentXRef.current = e.touches[0].clientX;
        setIsDragging(true);
    }, []);

    const handleTouchMove = useCallback((e: React.TouchEvent) => {
        if (!isDragging) return;
        currentXRef.current = e.touches[0].clientX;
        const diff = currentXRef.current - startXRef.current;
        setDragOffset(diff);
    }, [isDragging]);

    const handleTouchEnd = useCallback(() => {
        if (!isDragging) return;
        setIsDragging(false);

        const diff = currentXRef.current - startXRef.current;
        const threshold = 50;

        if (diff < -threshold && activeIndex < teachers.length - 1) {
            setActiveIndex(prev => prev + 1);
        } else if (diff > threshold && activeIndex > 0) {
            setActiveIndex(prev => prev - 1);
        }

        setDragOffset(0);
    }, [isDragging, activeIndex, teachers.length]);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        startXRef.current = e.clientX;
        currentXRef.current = e.clientX;
        setIsDragging(true);
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!isDragging) return;
        currentXRef.current = e.clientX;
        const diff = currentXRef.current - startXRef.current;
        setDragOffset(diff);
    }, [isDragging]);

    const handleMouseUp = useCallback(() => {
        if (!isDragging) return;
        setIsDragging(false);

        const diff = currentXRef.current - startXRef.current;
        const threshold = 50;

        if (diff < -threshold && activeIndex < teachers.length - 1) {
            setActiveIndex(prev => prev + 1);
        } else if (diff > threshold && activeIndex > 0) {
            setActiveIndex(prev => prev - 1);
        }

        setDragOffset(0);
    }, [isDragging, activeIndex, teachers.length]);

    if (teachers.length === 0) return null;

    const currentTeacher = teachers[activeIndex];

    return (
        <div className="swipeable-cards">
            {/* Card indicators */}
            <div className="swipe-indicators">
                {teachers.map((_, idx) => (
                    <button
                        key={idx}
                        className={`swipe-indicator ${idx === activeIndex ? 'swipe-indicator-active' : ''}`}
                        onClick={() => setActiveIndex(idx)}
                        aria-label={`Show teacher ${idx + 1}`}
                    />
                ))}
            </div>

            {/* Swipeable card */}
            <div
                className={`swipeable-card-container ${isDragging ? 'swipeable-dragging' : ''}`}
                ref={containerRef}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => { if (isDragging) handleMouseUp(); }}
            >
                <div
                    className="swipeable-card"
                    style={{
                        transform: `translateX(calc(-${activeIndex * 100}% + ${dragOffset}px))`,
                    }}
                >
                    {teachers.map((teacher) => (
                        <div key={teacher.id} className="swipe-card">
                            <div className="swipe-card-header">
                                <Avatar
                                    name={teacher.name}
                                    imageUrl={teacher.image_url}
                                    className="swipe-card-avatar"
                                />
                                <div className="swipe-card-info">
                                    <h3 className="swipe-card-name">{teacher.name}</h3>
                                    <p className="swipe-card-dept">{teacher.department}</p>
                                </div>
                                <button
                                    className="swipe-card-remove"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onRemove(teacher.id);
                                    }}
                                    aria-label={`Remove ${teacher.name}`}
                                >
                                    ×
                                </button>
                            </div>

                            <div className="swipe-card-stats">
                                <div className="swipe-stat">
                                    <span className="swipe-stat-value">{teacher.review_count || 0}</span>
                                    <span className="swipe-stat-label">Reviews</span>
                                </div>
                                <div className="swipe-stat">
                                    <span className="swipe-stat-value">
                                        {teacher.reviews && teacher.reviews.length > 0
                                            ? timeAgo(teacher.reviews[0].created_at)
                                            : '—'}
                                    </span>
                                    <span className="swipe-stat-label">Latest</span>
                                </div>
                            </div>

                            {teacher.reviews && teacher.reviews.length > 0 && (
                                <div className="swipe-card-reviews">
                                    {teacher.reviews.slice(0, 3).map((review, idx) => (
                                        <blockquote key={review.id || idx} className="swipe-review-quote">
                                            "{review.comment.length > 120
                                                ? `${review.comment.slice(0, 120)}…`
                                                : review.comment}"
                                            <footer className="swipe-review-author">
                                                — {review.user_name || 'Anonymous'} · {new Date(review.created_at).toLocaleDateString()}
                                            </footer>
                                        </blockquote>
                                    ))}
                                    {teacher.reviews.length > 3 && (
                                        <p className="swipe-reviews-more">
                                            +{teacher.reviews.length - 3} more review{teacher.reviews.length - 3 !== 1 ? 's' : ''}
                                        </p>
                                    )}
                                </div>
                            )}

                            <button
                                className="swipe-card-view-btn"
                                onClick={() => onTeacherClick(teacher)}
                            >
                                View full profile
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Navigation arrows */}
            {teachers.length > 1 && (
                <div className="swipe-nav">
                    <button
                        className="swipe-nav-btn"
                        onClick={() => setActiveIndex(prev => Math.max(0, prev - 1))}
                        disabled={activeIndex === 0}
                        aria-label="Previous teacher"
                    >
                        <Icon name="chevron-left" size={20} />
                    </button>
                    <span className="swipe-nav-count">
                        {activeIndex + 1} / {teachers.length}
                    </span>
                    <button
                        className="swipe-nav-btn"
                        onClick={() => setActiveIndex(prev => Math.min(teachers.length - 1, prev + 1))}
                        disabled={activeIndex === teachers.length - 1}
                        aria-label="Next teacher"
                    >
                        <span style={{ display: 'inline-block', transform: 'rotate(180deg)' }}><Icon name="chevron-left" size={20} /></span>
                    </button>
                </div>
            )}
        </div>
    );
};

export default SwipeableCards;
