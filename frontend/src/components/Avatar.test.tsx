import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
// react-dom/test-utils (Simulate) is gone in React 19; a real DOM event does the same job.
import { fireEvent } from '@testing-library/dom';
import Avatar, { PHOTO_STALL_MS } from './Avatar';
import { isUsableImageUrl } from '../utils/imageThumb';

// React 18 wants this flag set around act() in tests
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const UMT_PHOTO = 'https://admin.umt.edu.pk/Media/UserProfile/636753931581232459123.JPG';
const BROKEN_DIR = 'https://admin.umt.edu.pk/Media/UserProfile/';
const OTHER_HOST = 'https://some-other-site.com/photo.jpg';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const render = (ui: React.ReactElement) => act(() => { root.render(ui); });
const img = () => container.querySelector('img');
const srcOf = () => img()?.getAttribute('src') || '';
const FILE = '636753931581232459123.JPG';

/** Every avatar configuration actually used across the app's screens. */
const SCREENS = [
    { screen: 'Teacher list card (App.tsx / DepartmentPage.tsx)', className: 'teacher-card-image', size: undefined, expected: 80 },
    { screen: 'Teacher detail hero (TeacherDetailView.tsx)', className: 'teacher-detail-image', size: 130, expected: 130 },
    { screen: 'Search autocomplete (TeacherAutocomplete.tsx)', className: 'autocomplete-avatar', size: 48, expected: 48 },
    { screen: 'Compare table header (CompareView.tsx)', className: 'compare-table-avatar', size: 72, expected: 72 },
    { screen: 'Compare selected card (CompareView.tsx)', className: 'compare-selected-photo', size: 112, expected: 112 },
    { screen: 'Swipeable compare card (SwipeableCards.tsx)', className: 'swipe-card-avatar', size: undefined, expected: 80 },
    { screen: 'Admin teacher details (AdminPanel.tsx)', className: 'admin-detail-photo', size: 64, expected: 64 },
];

describe('Avatar — thumbnail loading across every screen', () => {
    SCREENS.forEach(({ screen, className, size, expected }) => {
        describe(screen, () => {
            it('requests a thumbnail at the right size from our own domain', () => {
                render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className={className} size={size} />);

                const el = img();
                expect(el).not.toBeNull();
                expect(el!.className).toBe(className);
                expect(el!.getAttribute('loading')).toBe('lazy');
                expect(el!.getAttribute('decoding')).toBe('async');
                expect(el!.getAttribute('alt')).toBe('Dr Jane Doe');

                expect(srcOf()).toBe(`/img/t/${expected}/${FILE}`);
            });

            it('offers a 2x variant for high-DPI phones', () => {
                render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className={className} size={size} />);
                const srcSet = img()!.getAttribute('srcset') || '';
                expect(srcSet).toContain(`/img/t/${expected}/${FILE} 1x`);
                expect(srcSet).toContain(`/img/t/${expected * 2}/${FILE} 2x`);
                expect(srcSet).toContain('2x');
            });

            it('falls back to the original via our domain, then straight from UMT', () => {
                render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className={className} size={size} />);
                act(() => { fireEvent.error(img()!); });
                expect(srcOf()).toBe(`/img/o/${FILE}`);
                expect(img()!.getAttribute('srcset')).toBeNull();

                act(() => { fireEvent.error(img()!); });
                expect(srcOf()).toBe(UMT_PHOTO);
            });

            it('falls back to initials if both the thumbnail and the original fail', () => {
                render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className={className} size={size} />);
                act(() => { fireEvent.error(img()!); }); // thumbnail failed
                act(() => { fireEvent.error(img()!); }); // original via our domain failed
                act(() => { fireEvent.error(img()!); }); // original from UMT failed

                expect(img()).toBeNull();
                // Initials come from the first two words (pre-existing behaviour)
                expect(container.textContent).toBe('DJ');
                const div = container.querySelector('div')!;
                expect(div.className).toBe(className);
                expect(div.getAttribute('aria-hidden')).toBe('true');
            });
        });
    });
});

describe('Avatar — perceived speed', () => {
    it('is lazy and not high-priority by default (off-screen photos must not compete with the page)', () => {
        render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className="teacher-card-image" />);
        expect(img()!.getAttribute('loading')).toBe('lazy');
        expect(img()!.hasAttribute('fetchpriority')).toBe(false);
    });

    it('loads immediately at high priority when marked as on-screen', () => {
        render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className="teacher-card-image" priority />);
        expect(img()!.getAttribute('loading')).toBe('eager');
        expect(img()!.getAttribute('fetchpriority')).toBe('high');
    });

    it('paints a placeholder behind the photo while it downloads', () => {
        const { TextEncoder: NodeTextEncoder } = require('util');
        (globalThis as any).TextEncoder = (globalThis as any).TextEncoder || NodeTextEncoder;
        const { renderToStaticMarkup } = require('react-dom/server');
        const html = renderToStaticMarkup(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className="teacher-card-image" />);
        expect(html).toContain('<img');
        // Matches the flat cream used by the editorial theme's avatar fallback.
        expect(html).toContain('background:#F7F1E6');
    });

    it('keeps list thumbnails small: a ~60px circle must not request more than 80px (1x) / 160px (2x)', () => {
        render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className="teacher-card-image" />);
        expect(srcOf()).toBe(`/img/t/80/${FILE}`);
        expect(img()!.getAttribute('srcset')).toContain('/img/t/160/');
        expect(img()!.getAttribute('srcset')).not.toContain('/img/t/320/');
    });
});

describe('Avatar — data the app really contains', () => {
    it('shows initials (not a broken image) for truncated directory URLs', () => {
        expect(isUsableImageUrl(BROKEN_DIR)).toBe(false);
        SCREENS.forEach(({ className, size }) => {
            render(<Avatar name="Ms Rushda" imageUrl={BROKEN_DIR} className={className} size={size} />);
            expect(img()).toBeNull();
            expect(container.textContent).toBe('MR');
            act(() => root.unmount());
            root = createRoot(container);
        });
    });

    it('shows initials when there is no image_url at all', () => {
        render(<Avatar name="Muhammad Ali" imageUrl={null} className="teacher-card-image" />);
        expect(img()).toBeNull();
        expect(container.textContent).toBe('MA');
    });

    it('handles blank/whitespace image URLs', () => {
        render(<Avatar name="Sara Khan" imageUrl="   " className="teacher-card-image" />);
        expect(img()).toBeNull();
        expect(container.textContent).toBe('SK');
    });

    it('leaves images on hosts we do not proxy untouched (no open proxy)', () => {
        render(<Avatar name="Dr Jane Doe" imageUrl={OTHER_HOST} className="teacher-card-image" />);
        expect(srcOf()).toBe(OTHER_HOST);
        expect(img()!.getAttribute('srcset')).toBeNull();
    });

    it('recovers the thumbnail when the avatar is reused for a different teacher', () => {
        render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className="teacher-card-image" />);
        act(() => { fireEvent.error(img()!); });
        expect(srcOf()).toBe(`/img/o/${FILE}`);

        // Same component instance, new teacher (e.g. autocomplete list reuse)
        render(<Avatar name="Dr John Roe" imageUrl={UMT_PHOTO.replace('636753931581232459123.JPG', '639015873261646639164.jpg')} className="teacher-card-image" />);
        expect(srcOf()).toBe('/img/t/80/639015873261646639164.jpg');
    });

    it('uses a sensible single initial for a one-word name', () => {
        render(<Avatar name="Anonymous" imageUrl={null} className="teacher-card-image" />);
        expect(container.textContent).toBe('A');
    });
});

describe('Avatar — stalled photos', () => {
    afterEach(() => { vi.useRealTimers(); });

    it('moves on when a source neither loads nor errors (blocked networks stall)', () => {
        vi.useFakeTimers();
        render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className="teacher-card-image" priority />);
        expect(srcOf()).toBe(`/img/t/80/${FILE}`);
        act(() => { vi.advanceTimersByTime(PHOTO_STALL_MS + 10); });
        expect(srcOf()).toBe(`/img/o/${FILE}`);
        act(() => { vi.advanceTimersByTime(PHOTO_STALL_MS + 10); });
        expect(srcOf()).toBe(UMT_PHOTO);
        // The last source is never abandoned for being slow.
        act(() => { vi.advanceTimersByTime(PHOTO_STALL_MS * 3); });
        expect(srcOf()).toBe(UMT_PHOTO);
    });

    it('keeps a photo that has loaded', () => {
        vi.useFakeTimers();
        render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className="teacher-card-image" priority />);
        Object.defineProperty(img()!, 'complete', { value: true, configurable: true });
        Object.defineProperty(img()!, 'naturalWidth', { value: 80, configurable: true });
        act(() => { vi.advanceTimersByTime(PHOTO_STALL_MS * 2); });
        expect(srcOf()).toBe(`/img/t/80/${FILE}`);
    });

    it('waits for an off-screen lazy photo to scroll into view before counting', () => {
        vi.useFakeTimers();
        let trigger: ((entries: { isIntersecting: boolean }[]) => void) | undefined;
        const original = (globalThis as any).IntersectionObserver;
        (globalThis as any).IntersectionObserver = class {
            constructor(cb: (entries: { isIntersecting: boolean }[]) => void) { trigger = cb; }
            observe() {}
            disconnect() {}
        };
        try {
            render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className="teacher-card-image" />);
            act(() => { vi.advanceTimersByTime(PHOTO_STALL_MS * 3); });
            expect(srcOf()).toBe(`/img/t/80/${FILE}`); // never scrolled into view
            act(() => { trigger!([{ isIntersecting: true }]); });
            act(() => { vi.advanceTimersByTime(PHOTO_STALL_MS + 10); });
            expect(srcOf()).toBe(`/img/o/${FILE}`);
        } finally {
            (globalThis as any).IntersectionObserver = original;
        }
    });
});
