import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { Simulate } from 'react-dom/test-utils';
import Avatar from './Avatar';
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
const proxyParams = () => new URLSearchParams(srcOf().split('?')[1] || '');

/** Every avatar configuration actually used across the app's screens. */
const SCREENS = [
    { screen: 'Teacher list card (App.tsx / DepartmentPage.tsx)', className: 'teacher-card-image', size: undefined, expected: 160 },
    { screen: 'Teacher detail hero (TeacherDetailView.tsx)', className: 'teacher-detail-image', size: 260, expected: 260 },
    { screen: 'Search autocomplete (TeacherAutocomplete.tsx)', className: 'autocomplete-avatar', size: undefined, expected: 160 },
    { screen: 'Compare table header (CompareView.tsx)', className: 'compare-table-avatar', size: 136, expected: 136 },
    { screen: 'Compare selected card (CompareView.tsx)', className: 'compare-selected-photo', size: 112, expected: 112 },
    { screen: 'Swipeable compare card (SwipeableCards.tsx)', className: 'swipe-card-avatar', size: undefined, expected: 160 },
    { screen: 'Admin teacher details (AdminPanel.tsx)', className: 'admin-detail-photo', size: 112, expected: 112 },
];

describe('Avatar — thumbnail loading across every screen', () => {
    SCREENS.forEach(({ screen, className, size, expected }) => {
        describe(screen, () => {
            it('requests a WebP thumbnail at the right size', () => {
                render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className={className} size={size} />);

                const el = img();
                expect(el).not.toBeNull();
                expect(el!.className).toBe(className);
                expect(el!.getAttribute('loading')).toBe('lazy');
                expect(el!.getAttribute('decoding')).toBe('async');
                expect(el!.getAttribute('alt')).toBe('Dr Jane Doe');

                expect(srcOf().startsWith('https://wsrv.nl/?')).toBe(true);
                expect(proxyParams().get('url')).toBe(UMT_PHOTO);
                expect(proxyParams().get('w')).toBe(String(expected));
                expect(proxyParams().get('h')).toBe(String(expected));
                expect(proxyParams().get('fit')).toBe('cover');
                expect(proxyParams().get('output')).toBe('webp');
            });

            it('offers a 2x variant for high-DPI phones', () => {
                render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className={className} size={size} />);
                const srcSet = img()!.getAttribute('srcset') || '';
                expect(srcSet).toContain(`w=${expected}`);
                expect(srcSet).toContain(`w=${expected * 2}`);
                expect(srcSet).toContain('2x');
            });

            it('falls back to the original photo if the thumbnail fails', () => {
                render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className={className} size={size} />);
                expect(srcOf()).not.toBe(UMT_PHOTO);

                act(() => { Simulate.error(img()!); });

                expect(srcOf()).toBe(UMT_PHOTO);
                expect(img()!.getAttribute('srcset')).toBeNull();
            });

            it('falls back to initials if both the thumbnail and the original fail', () => {
                render(<Avatar name="Dr Jane Doe" imageUrl={UMT_PHOTO} className={className} size={size} />);
                act(() => { Simulate.error(img()!); }); // thumbnail failed
                act(() => { Simulate.error(img()!); }); // original failed

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
        act(() => { Simulate.error(img()!); });
        expect(srcOf()).toBe(UMT_PHOTO);

        // Same component instance, new teacher (e.g. autocomplete list reuse)
        render(<Avatar name="Dr John Roe" imageUrl={UMT_PHOTO.replace('636753931581232459123.JPG', '639015873261646639164.jpg')} className="teacher-card-image" />);
        expect(srcOf().startsWith('https://wsrv.nl/?')).toBe(true);
    });

    it('uses a sensible single initial for a one-word name', () => {
        render(<Avatar name="Anonymous" imageUrl={null} className="teacher-card-image" />);
        expect(container.textContent).toBe('A');
    });
});
