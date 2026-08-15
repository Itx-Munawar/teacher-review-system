import React, { useEffect, useRef, useState } from 'react';

interface PullToRefreshProps {
    onRefresh: () => Promise<unknown> | void;
    children: React.ReactNode;
    threshold?: number;
}

const PullToRefresh: React.FC<PullToRefreshProps> = ({ onRefresh, children, threshold = 70 }) => {
    const [pullDistance, setPullDistance] = useState(0);
    const [refreshing, setRefreshing] = useState(false);
    const pullRef = useRef(0);
    const startYRef = useRef<number | null>(null);
    const activeRef = useRef(false);
    const refreshingRef = useRef(false);
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
            const damped = Math.min(delta * 0.45, 130);
            pullRef.current = damped;
            setPullDistance(damped);
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
                Promise.resolve(onRefreshRef.current()).finally(() => {
                    refreshingRef.current = false;
                    setRefreshing(false);
                    pullRef.current = 0;
                    setPullDistance(0);
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

    const show = pullDistance > 4 || refreshing;

    return (
        <div className="ptr-root">
            <div
                className={`ptr-indicator${refreshing ? ' ptr-refreshing' : pullDistance >= threshold ? ' ptr-ready' : ''}`}
                style={{
                    transform: `translate(-50%, ${pullDistance}px)`,
                    opacity: show ? 1 : 0,
                }}
                aria-hidden={!show}
            >
                {refreshing ? (
                    <span className="spinner-small" />
                ) : pullDistance >= threshold ? (
                    <span>Release to refresh</span>
                ) : (
                    <span>Pull to refresh</span>
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
