import React, { useEffect, useRef, useState, useCallback } from 'react';
import { haptic } from '../utils/haptics';

interface PullToRefreshProps {
    onRefresh: () => Promise<unknown> | void;
    children: React.ReactNode;
    threshold?: number;
}

const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, children, threshold = 80 }) => {
    const [pullDistance, setPullDistance] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const pullRef = useRef(0);
    const startYRef = useRef<number | null>(null);
    const activeRef = useRef(false);
    const refreshingRef = useRef(false);
    const reachedThresholdRef = useRef(false);
    const onRefreshRef = useRef(onRefresh);
    onRefreshRef.current = onRefresh;

    const isTouchDevice = () =>
        typeof window !== 'undefined' &&
        (window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 768);

    const isInsideScrollable = (target: EventTarget | null): boolean => {
        const el = target as HTMLElement | null;
        if (!el) return false;
        if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
        let node: HTMLElement | null = el;
        while (node && node !== document.body) {
            const style = window.getComputedStyle(node);
            const oy = style.overflowY;
            const ox = style.overflowX;
            const scrollableY = (oy === 'auto' || oy === 'scroll') && node.scrollHeight > node.clientHeight;
            const scrollableX = (ox === 'auto' || ox === 'scroll') && node.scrollWidth > node.clientWidth;
            if (scrollableY || scrollableX) return true;
            node = node.parentElement;
        }
        return false;
    };

    useEffect(() => {
        if (!isTouchDevice()) return;

        const onTouchStart = (e: TouchEvent) => {
            if (refreshingRef.current) return;
            if (isInsideScrollable(e.target)) {
                startYRef.current = null;
                activeRef.current = false;
                return;
            }
            if (window.scrollY <= 0) {
                startYRef.current = e.touches[0].clientY;
                activeRef.current = true;
                reachedThresholdRef.current = false;
            } else {
                startYRef.current = null;
                activeRef.current = false;
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            if (!activeRef.current || startYRef.current === null || refreshingRef.current) return;
            const delta = e.touches[0].clientY - startYRef.current;
            if (delta <= 0 || window.scrollY > 0) {
                pullRef.current = 0;
                setPullDistance(0);
                return;
            }
            e.preventDefault();
            // Rubber-band damping: starts linear then decelerates
            const damped = Math.min(delta * 0.5, 150);
            pullRef.current = damped;
            setPullDistance(damped);

            // Haptic feedback when crossing threshold
            if (damped >= threshold && !reachedThresholdRef.current) {
                reachedThresholdRef.current = true;
                haptic([10, 30, 10]);
            } else if (damped < threshold) {
                reachedThresholdRef.current = false;
            }
        };

        const finish = () => {
            if (!activeRef.current) return;
            activeRef.current = false;
            startYRef.current = null;
            if (refreshingRef.current) return;
            if (pullRef.current >= threshold) {
                refreshingRef.current = true;
                setRefreshing(true);
                setPullDistance(threshold);
                haptic(20);
                Promise.resolve(onRefreshRef.current()).finally(() => {
                    refreshingRef.current = false;
                    setRefreshing(false);
                    setShowSuccess(true);
                    haptic([5, 50, 5]);
                    setTimeout(() => {
                        setShowSuccess(false);
                        pullRef.current = 0;
                        setPullDistance(0);
                    }, 600);
                });
            } else {
                pullRef.current = 0;
                setPullDistance(0);
            }
        };

        window.addEventListener('touchstart', onTouchStart, { passive: true });
        window.addEventListener('touchmove', onTouchMove, { passive: false });
        window.addEventListener('touchend', finish);
        window.addEventListener('touchcancel', finish);
        return () => {
            window.removeEventListener('touchstart', onTouchStart);
            window.removeEventListener('touchmove', onTouchMove);
            window.removeEventListener('touchend', finish);
            window.removeEventListener('touchcancel', finish);
        };
    }, [threshold]);

    const progress = Math.min(pullDistance / threshold, 1);
    const show = pullDistance > 4 || refreshing || showSuccess;

    return (
        <div className="ptr-root">
            <div
                className={`ptr-indicator ${refreshing ? 'ptr-refreshing' : ''} ${showSuccess ? 'ptr-success' : ''} ${pullDistance >= threshold && !refreshing ? 'ptr-ready' : ''}`}
                style={{
                    transform: `translate(-50%, ${Math.min(pullDistance, threshold + 20)}px)`,
                    opacity: show ? 1 : 0,
                }}
                aria-hidden={!show}
            >
                {showSuccess ? (
                    <div className="ptr-success-icon">
                        <svg viewBox="0 0 24 24" fill="none" className="ptr-checkmark">
                            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" opacity="0.3" />
                            <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="ptr-checkmark-path" />
                        </svg>
                        <span className="ptr-label">Updated!</span>
                    </div>
                ) : refreshing ? (
                    <div className="ptr-spinner-wrapper">
                        <svg viewBox="0 0 36 36" className="ptr-spinner">
                            <circle
                                cx="18" cy="18" r="15"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeDasharray="94"
                                strokeDashoffset="25"
                                strokeLinecap="round"
                                className="ptr-spinner-track"
                            />
                            <circle
                                cx="18" cy="18" r="15"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeDasharray="94"
                                strokeDashoffset="25"
                                strokeLinecap="round"
                                className="ptr-spinner-arc"
                            />
                        </svg>
                        <span className="ptr-label">Refreshing...</span>
                    </div>
                ) : (
                    <div className="ptr-pull-indicator">
                        <svg viewBox="0 0 36 36" className="ptr-progress-ring">
                            <circle
                                cx="18" cy="18" r="15"
                                fill="none"
                                stroke="rgba(255,255,255,0.1)"
                                strokeWidth="2"
                            />
                            <circle
                                cx="18" cy="18" r="15"
                                fill="none"
                                stroke={pullDistance >= threshold ? '#10b981' : '#667eea'}
                                strokeWidth="2.5"
                                strokeDasharray="94"
                                strokeDashoffset={94 - (94 * progress)}
                                strokeLinecap="round"
                                className="ptr-progress-arc"
                            />
                        </svg>
                        <span className="ptr-label">
                            {pullDistance >= threshold ? 'Release to refresh' : 'Pull to refresh'}
                        </span>
                    </div>
                )}
            </div>
            <div
                className="ptr-content"
                style={pullDistance > 0 ? { transform: `translateY(${pullDistance}px)` } : undefined}
            >
                {children}
            </div>
        </div>
    );
};

export default PullToRefresh;
