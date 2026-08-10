import React, { useEffect, useRef } from 'react';

const COLORS = ['#ff5e9c', '#ff9a56', '#00c9ff', '#a855f7', '#a3e635', '#fbbf24', '#38bdf8', '#f472b6'];

interface Particle {
    x: number;
    y: number;
    z: number;
    vx: number;
    vy: number;
    size: number;
    color: string;
    alpha: number;
}

const ParticleBackground: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        // Skip the animation on touch/mobile devices and when the user prefers reduced motion
        if (window.matchMedia('(pointer: coarse)').matches || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            return;
        }

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = window.innerWidth;
        let height = window.innerHeight;
        const mouse = { x: -9999, y: -9999 };

        const setupCanvas = () => {
            const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };
        setupCanvas();

        const count = Math.min(80, Math.max(24, Math.floor((width * height) / 24000)));
        const particles: Particle[] = Array.from({ length: count }, () => ({
            x: Math.random() * width,
            y: Math.random() * height,
            z: Math.random() * 3 + 1,
            vx: (Math.random() - 0.5) * 0.45,
            vy: (Math.random() - 0.5) * 0.45,
            size: Math.random() * 3.2 + 1,
            color: COLORS[Math.floor(Math.random() * COLORS.length)],
            alpha: Math.random() * 0.55 + 0.2,
        }));

        const handleResize = () => {
            setupCanvas();
        };

        const handleMouseMove = (e: MouseEvent) => {
            mouse.x = e.clientX;
            mouse.y = e.clientY;
        };

        const handleMouseLeave = () => {
            mouse.x = -9999;
            mouse.y = -9999;
        };

        window.addEventListener('resize', handleResize);
        window.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseleave', handleMouseLeave);

        let raf = 0;
        const tick = () => {
            ctx.clearRect(0, 0, width, height);
            ctx.globalCompositeOperation = 'lighter';

            for (const p of particles) {
                p.x += p.vx * p.z;
                p.y += p.vy * p.z;

                const dx = p.x - mouse.x;
                const dy = p.y - mouse.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const radius = 140;
                if (dist < radius && dist > 0) {
                    const force = ((radius - dist) / radius) * 0.6 * p.z;
                    p.x += (dx / dist) * force;
                    p.y += (dy / dist) * force;
                }

                if (p.x < -20) p.x = width + 20;
                if (p.x > width + 20) p.x = -20;
                if (p.y < -20) p.y = height + 20;
                if (p.y > height + 20) p.y = -20;

                const glowSize = p.size * p.z * 1.1;

                // soft outer halo (cheap glow, no shadowBlur)
                ctx.globalAlpha = p.alpha * 0.3;
                ctx.beginPath();
                ctx.arc(p.x, p.y, glowSize * 2.2, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();

                // bright core
                ctx.globalAlpha = p.alpha;
                ctx.beginPath();
                ctx.arc(p.x, p.y, glowSize, 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
            }
            ctx.globalAlpha = 1;
            raf = requestAnimationFrame(tick);
        };

        const start = () => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(tick);
        };

        const stop = () => {
            cancelAnimationFrame(raf);
            raf = 0;
        };

        // Pause the animation while the tab is hidden to save battery/CPU
        const handleVisibility = () => {
            if (document.hidden) stop();
            else start();
        };

        tick();
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener('resize', handleResize);
            window.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseleave', handleMouseLeave);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    return <canvas className="particle-bg" ref={canvasRef} aria-hidden="true" />;
};

export default ParticleBackground;
