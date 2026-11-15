import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import App from './App';
import type { Teacher } from './types';

vi.mock('./services/api', async () => {
    const actual = await vi.importActual<typeof import('./services/api')>('./services/api');
    return {
        ...actual,
        getTeachers: vi.fn(),
        getDepartments: vi.fn(),
        getChatStatus: vi.fn(),
        getStats: vi.fn(),
        getRelatedTeachers: vi.fn(),
        searchAllTeachers: vi.fn(),
        getTeacherDetail: vi.fn(),
        getTeacherSummary: vi.fn(),
        getTeacherQuestions: vi.fn(),
        trackEvent: vi.fn(),
    };
});

import {
    getTeachers,
    getDepartments,
    getChatStatus,
    getStats,
    getRelatedTeachers,
    searchAllTeachers,
    getTeacherDetail,
    getTeacherSummary,
    getTeacherQuestions,
    trackEvent,
} from './services/api';

const UMER: Teacher = { id: 917, name: 'Umer Usman', department: 'School of Systems and Technology', review_count: 11 };
const WAQAR: Teacher = { id: 918, name: 'Waqar Ashiq', department: 'School of Systems and Technology', review_count: 11 };
const ALI_HARRIS: Teacher = { id: 53, name: 'Ali Harris', department: 'School of Systems and Technology', review_count: 2 };
const ALI_RAZA: Teacher = { id: 54, name: 'Ali Raza', department: 'School of Systems and Technology', review_count: 0 };

/** Renders the current route path so tests can see navigations. */
const LocationSpy: React.FC = () => {
    const location = useLocation();
    return <div data-testid="location">{location.pathname}{location.search}</div>;
};

function renderApp() {
    return render(
        <MemoryRouter initialEntries={['/']}>
            <Routes>
                <Route path="*" element={<><LocationSpy /><App /></>} />
            </Routes>
        </MemoryRouter>
    );
}

describe('App — search (regression)', () => {
    beforeEach(() => {
        // jsdom has no matchMedia; PullToRefresh (rendered by App) calls it.
        if (typeof window.matchMedia !== 'function') {
            Object.defineProperty(window, 'matchMedia', {
                writable: true,
                value: vi.fn().mockImplementation((query: string) => ({
                    matches: false,
                    media: query,
                    onchange: null,
                    addListener: vi.fn(),
                    removeListener: vi.fn(),
                    addEventListener: vi.fn(),
                    removeEventListener: vi.fn(),
                    dispatchEvent: vi.fn(),
                })),
            });
        }
        // jsdom has no IntersectionObserver; LazySection (in the detail
        // view) constructs one, so the stub must be a class, not an arrow
        // function — and it must report elements as visible, or lazy
        // sections never render their children in tests.
        if (typeof window.IntersectionObserver === 'undefined') {
            class IntersectionObserverStub {
                constructor(private callback: (entries: { isIntersecting: boolean; target: Element }[]) => void) {}
                observe(target: Element) {
                    this.callback([{ isIntersecting: true, target }]);
                }
                unobserve() { /* no-op */ }
                disconnect() { /* no-op */ }
            }
            Object.defineProperty(window, 'IntersectionObserver', {
                writable: true,
                value: IntersectionObserverStub,
            });
        }
        vi.clearAllMocks();
        vi.mocked(getTeachers).mockResolvedValue({
            data: { teachers: [UMER, WAQAR], pagination: { page: 1, limit: 20, total: 2, totalPages: 1 } },
        } as never);
        vi.mocked(getDepartments).mockResolvedValue({ data: [] } as never);
        vi.mocked(getChatStatus).mockResolvedValue({ data: { enabled: false } } as never);
        vi.mocked(getStats).mockResolvedValue({
            teachers: 966, departments: 27, reviews: 414, reviewed_teachers: 204,
        } as never);
        vi.mocked(getRelatedTeachers).mockResolvedValue({ data: [] } as never);
        vi.mocked(searchAllTeachers).mockResolvedValue({ data: [ALI_HARRIS, ALI_RAZA] } as never);
        vi.mocked(getTeacherSummary).mockResolvedValue({ data: null } as never);
        vi.mocked(getTeacherQuestions).mockResolvedValue({ data: [] } as never);
        vi.mocked(trackEvent).mockResolvedValue({} as never);
    });

    it('typing a query filters the teacher list to the matches', async () => {
        vi.mocked(getTeacherDetail).mockResolvedValue({ data: {} } as never);
        renderApp();

        await waitFor(() => expect(screen.getByText('Umer Usman')).toBeInTheDocument());

        const input = screen.getByPlaceholderText('Search by teacher or department');
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'Ali' } });

        // The list — not just the dropdown — shows the matches, and the
        // "Found N teachers" line appears. (Each name appears twice: once
        // in the dropdown suggestion, once in the filtered list card.)
        await waitFor(() => expect(screen.getByText(/Found 2 teachers matching/)).toBeInTheDocument(), { timeout: 5000 });
        expect(screen.queryByText('Umer Usman')).not.toBeInTheDocument();
        expect(screen.getAllByText('Ali Harris').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Ali Raza').length).toBeGreaterThanOrEqual(1);
    });

    it('clicking a suggestion navigates immediately, before the detail API answers', async () => {
        let resolveDetail!: (value: unknown) => void;
        const detailPending = new Promise((resolve) => { resolveDetail = resolve; });
        vi.mocked(getTeacherDetail).mockReturnValue(detailPending as never);
        renderApp();

        await waitFor(() => expect(screen.getByText('Umer Usman')).toBeInTheDocument());

        const input = screen.getByPlaceholderText('Search by teacher or department');
        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: 'Ali' } });

        const option = await waitFor(() => screen.getByRole('option', { name: /Ali Harris/ }), { timeout: 5000 });
        fireEvent.mouseDown(option);

        // Navigation + skeleton happen synchronously on the click, while the
        // detail request is still pending: the click must never look dead.
        expect(screen.getByTestId('location')).toHaveTextContent('/teacher/53');
        expect(document.querySelector('.skeleton-detail')).not.toBeNull();
        expect(vi.mocked(getTeacherDetail)).toHaveBeenCalledWith(53);

        resolveDetail({
            data: {
                teacher: ALI_HARRIS,
                reviews: [{
                    id: 386, teacher_id: 53, comment: 'Bht achy teacher h',
                    user_name: 'Anonymous', courses: null, is_approved: 1,
                    created_at: '2026-09-15T04:26:00.000Z', helpful_count: 0,
                    voted: false, replies: [],
                }],
                total_reviews: 2,
                review_pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
                filtered_reviews: 2,
                review_sort: 'helpful',
                review_course: null,
                course_counts: [],
            },
        });
        // The review text may be split across elements by the detail view,
        // so match against the rendered text as a whole.
        await waitFor(() => expect(document.body.textContent).toContain('Bht achy teacher h'), { timeout: 5000 });
    }, 15000);
});
