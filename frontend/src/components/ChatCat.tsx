import React, { useEffect, useRef } from 'react';
import './ChatCat.css';

export type CatMood = 'idle' | 'thinking' | 'happy';

interface ChatCatProps {
    /** "perch": head + paws + tail, sits on top of the launcher. "face": head only, for icons. */
    variant?: 'perch' | 'face';
    mood?: CatMood;
    /** Rendered width in CSS px. */
    size?: number;
    /** Eyes follow the mouse (desktop with a fine pointer only). */
    follow?: boolean;
    className?: string;
}

const canFollow = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(hover: hover) and (pointer: fine)').matches
    && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Pupils drift toward the pointer, eased with lerp 0.12 per frame; the loop
 * stops once settled (MotionSites "pointer parallax" recipe). Vertical travel
 * is ~0.7x horizontal so the look stays natural.
 */
const usePointerEyes = (ref: React.RefObject<SVGSVGElement | null>, enabled: boolean) => {
    useEffect(() => {
        const svg = ref.current;
        if (!enabled || !svg || !canFollow()) return undefined;
        let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
        const loop = () => {
            x += (tx - x) * 0.12;
            y += (ty - y) * 0.12;
            svg.style.setProperty('--px', x.toFixed(3));
            svg.style.setProperty('--py', y.toFixed(3));
            raf = (Math.abs(tx - x) > 0.002 || Math.abs(ty - y) > 0.002) ? requestAnimationFrame(loop) : 0;
        };
        const onMove = (e: PointerEvent) => {
            const r = svg.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const clamp = (v: number) => Math.max(-1, Math.min(1, v));
            tx = clamp((e.clientX - cx) / (window.innerWidth / 2));
            ty = clamp((e.clientY - cy) / (window.innerHeight / 2));
            if (!raf) raf = requestAnimationFrame(loop);
        };
        window.addEventListener('pointermove', onMove, { passive: true });
        return () => {
            window.removeEventListener('pointermove', onMove);
            if (raf) cancelAnimationFrame(raf);
        };
    }, [ref, enabled]);
};

/** A small cream-and-gold cat that blinks, twitches an ear and swishes its tail. */
const ChatCat: React.FC<ChatCatProps> = ({ variant = 'face', mood = 'idle', size, follow = false, className = '' }) => {
    const ref = useRef<SVGSVGElement>(null);
    usePointerEyes(ref, follow && mood === 'idle');
    const perch = variant === 'perch';
    const width = size ?? (perch ? 64 : 24);
    const viewBox = perch ? '0 0 72 60' : '12 5 48 47';
    const height = perch ? (width * 60) / 72 : width;

    return (
        <svg
            ref={ref}
            className={`chat-cat chat-cat--${variant} chat-cat--${mood} ${className}`.trim()}
            viewBox={viewBox}
            width={width}
            height={height}
            aria-hidden="true"
            focusable="false"
        >
            {perch && (
                <g className="chat-cat-tail">
                    <path d="M54 50 C64 48 68 38 64 28 C62 23 65 19.5 69 21.5" fill="none" stroke="var(--cat-ink)" strokeWidth="7.4" strokeLinecap="round" />
                    <path d="M54 50 C64 48 68 38 64 28 C62 23 65 19.5 69 21.5" fill="none" stroke="var(--cat-fur)" strokeWidth="4.4" strokeLinecap="round" />
                </g>
            )}
            <g className="chat-cat-head">
                <g className="chat-cat-ear chat-cat-ear-l">
                    <path d="M17 24 L15 7 L30 15 Z" fill="var(--cat-fur)" stroke="var(--cat-ink)" strokeWidth="1.8" strokeLinejoin="round" />
                    <path d="M19.2 20 L18.2 11.5 L26 15.6 Z" fill="var(--cat-ear)" />
                </g>
                <g className="chat-cat-ear chat-cat-ear-r">
                    <path d="M55 24 L57 7 L42 15 Z" fill="var(--cat-fur)" stroke="var(--cat-ink)" strokeWidth="1.8" strokeLinejoin="round" />
                    <path d="M52.8 20 L53.8 11.5 L46 15.6 Z" fill="var(--cat-ear)" />
                </g>
                <ellipse cx="36" cy="32" rx="21" ry="17.5" fill="var(--cat-fur)" stroke="var(--cat-ink)" strokeWidth="1.8" />
                <path d="M36 15.6 v4.4 M31 16.6 l1 3.8 M41 16.6 l-1 3.8" stroke="var(--cat-stripe)" strokeWidth="1.8" strokeLinecap="round" />
                <ellipse cx="22.5" cy="37.5" rx="3" ry="1.8" fill="var(--cat-cheek)" />
                <ellipse cx="49.5" cy="37.5" rx="3" ry="1.8" fill="var(--cat-cheek)" />
                {mood === 'happy' ? (
                    <path className="chat-cat-happy-eyes" d="M24.4 32.4 q3.6 -4.4 7.2 0 M40.4 32.4 q3.6 -4.4 7.2 0" fill="none" stroke="var(--cat-ink)" strokeWidth="2" strokeLinecap="round" />
                ) : (
                    <g className="chat-cat-eyes">
                        <ellipse cx="28" cy="31" rx="4.3" ry="4.8" fill="#fff" stroke="var(--cat-ink)" strokeWidth="1.3" />
                        <ellipse cx="44" cy="31" rx="4.3" ry="4.8" fill="#fff" stroke="var(--cat-ink)" strokeWidth="1.3" />
                        <g className="chat-cat-pupils">
                            <ellipse cx="28" cy="31.4" rx="2.4" ry="2.9" fill="var(--cat-ink)" />
                            <ellipse cx="44" cy="31.4" rx="2.4" ry="2.9" fill="var(--cat-ink)" />
                            <circle cx="28.9" cy="30.2" r="0.9" fill="#fff" />
                            <circle cx="44.9" cy="30.2" r="0.9" fill="#fff" />
                        </g>
                    </g>
                )}
                <path d="M34.2 36.2 h3.6 l-1.8 2.2 z" fill="var(--cat-nose)" />
                <path d="M36 38.4 q-1.6 2.6 -4.2 1.4 M36 38.4 q1.6 2.6 4.2 1.4" fill="none" stroke="var(--cat-ink)" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M13.5 34 l7.5 1 M14 38.6 l7.2 -0.8 M58.5 34 l-7.5 1 M58 38.6 l-7.2 -0.8" stroke="var(--cat-ink)" strokeWidth="1" strokeLinecap="round" opacity="0.55" />
            </g>
            {perch && (
                <g className="chat-cat-paws">
                    <ellipse cx="26" cy="51.5" rx="6.6" ry="4.6" fill="var(--cat-fur)" stroke="var(--cat-ink)" strokeWidth="1.6" />
                    <ellipse cx="46" cy="51.5" rx="6.6" ry="4.6" fill="var(--cat-fur)" stroke="var(--cat-ink)" strokeWidth="1.6" />
                    <path d="M24 50 v2.6 M28 50 v2.6 M44 50 v2.6 M48 50 v2.6" stroke="var(--cat-ink)" strokeWidth="1" strokeLinecap="round" opacity="0.45" />
                </g>
            )}
        </svg>
    );
};

export default ChatCat;
