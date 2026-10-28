import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent } from '@testing-library/dom';
import WelcomePanel from './WelcomePanel';
import { OPEN_CHAT_EVENT } from '../utils/chatEvents';
import type { Teacher } from '../types';

vi.mock('../services/api', () => ({
    getStats: vi.fn(() => Promise.resolve({ teachers: 966, departments: 27, reviews: 410, reviewed_teachers: 203 })),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const teacher = (id: number, reviews: number, photo = true): Teacher => ({
    id, name: `Teacher ${id}`, department: 'SST', review_count: reviews,
    image_url: photo ? `https://admin.umt.edu.pk/Media/UserProfile/${id}.JPG` : null,
} as Teacher);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })) as any;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(() => {
    act(() => root.unmount());
    container.remove();
});

const render = async (props: Partial<React.ComponentProps<typeof WelcomePanel>> = {}) => {
    await act(async () => {
        root.render(
            <MemoryRouter>
                <WelcomePanel departments={[{ department: 'SST', teacher_count: 5 }]} {...props} />
            </MemoryRouter>
        );
    });
    await act(async () => { await Promise.resolve(); });
};

describe('WelcomePanel hero', () => {
    it('shows the hand-broken headline and the site numbers', async () => {
        await render({ totalTeachersCount: 900, teachers: [teacher(1, 9), teacher(2, 7), teacher(3, 5)] });
        const title = container.querySelector('.home-title')!;
        expect(Array.from(title.querySelectorAll('.home-title-line')).map((l) => l.textContent!.trim()))
            .toEqual(['Reviews from', 'UMT students,', 'for UMT students.']);
        const values = Array.from(container.querySelectorAll('.home-stat-value')).map((v) => v.textContent);
        expect(values).toEqual(['966', '410', '27']);
        expect(container.textContent).toContain('203 teachers');
    });

    it('Find a teacher calls back and Ask AI opens the chat', async () => {
        const onFindTeacher = vi.fn();
        const opened = vi.fn();
        window.addEventListener(OPEN_CHAT_EVENT, opened);
        await render({ onFindTeacher, chatEnabled: true });
        fireEvent.click(container.querySelector('.home-cta-primary')!);
        fireEvent.click(container.querySelector('.home-cta-secondary')!);
        expect(onFindTeacher).toHaveBeenCalledTimes(1);
        expect(opened).toHaveBeenCalledTimes(1);
        window.removeEventListener(OPEN_CHAT_EVENT, opened);
    });

    it('hides Ask AI when chat is off and shows faces only for reviewed teachers with photos', async () => {
        await render({ teachers: [teacher(1, 9), teacher(2, 7), teacher(3, 5), teacher(4, 0), teacher(5, 8, false)] });
        expect(container.querySelector('.home-cta-secondary')).toBeNull();
        expect(container.querySelectorAll('.home-proof-face').length).toBe(3);
    });
});
