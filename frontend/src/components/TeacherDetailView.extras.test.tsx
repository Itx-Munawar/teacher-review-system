import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import TeacherDetailView from './TeacherDetailView';
import { voteHelpful, getTeacherSummary } from '../services/api';
import type { TeacherDetail } from '../types';

vi.mock('../services/api', () => ({
    replyToReview: vi.fn(),
    voteHelpful: vi.fn(),
    getTeacherSummary: vi.fn(),
}));
vi.mock('./LazySection', () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./QASection', () => ({ default: () => null }));

const mockedVote = vi.mocked(voteHelpful);
const mockedSummary = vi.mocked(getTeacherSummary);
type ApiResult = Awaited<ReturnType<typeof voteHelpful>>;

const makeTeacher = (overrides: Partial<TeacherDetail> = {}): TeacherDetail => ({
    id: 7,
    name: 'Waqar Ashiq',
    department: 'School of Systems and Technology',
    review_count: 3,
    total_reviews: 3,
    review_sort: 'newest',
    review_course: null,
    course_counts: [
        { course: 'Calculus I', count: 2 },
        { course: 'Linear Algebra', count: 1 },
    ],
    reviews: [
        { id: 1, teacher_id: 7, comment: 'Oldest but most helpful.', user_name: 'A', created_at: '2026-01-01T10:00:00Z', helpful_count: 9, voted: false },
        { id: 2, teacher_id: 7, comment: 'Newest review.', user_name: 'B', created_at: '2026-03-01T10:00:00Z', helpful_count: 0, voted: false },
        { id: 3, teacher_id: 7, comment: 'Middle review.', user_name: 'C', created_at: '2026-02-01T10:00:00Z', helpful_count: 2, voted: true },
    ],
    ...overrides,
});

const renderView = (teacher: TeacherDetail, extra: Partial<React.ComponentProps<typeof TeacherDetailView>> = {}) => {
    const props = {
        selectedTeacher: teacher,
        relatedTeachers: [],
        onShowReviewForm: vi.fn(),
        onClearSelectedTeacher: vi.fn(),
        onTeacherClick: vi.fn(),
        showToast: vi.fn(),
        onChangeReviewQuery: vi.fn(),
        ...extra,
    };
    render(<TeacherDetailView {...props} />);
    return props;
};

const commentsInOrder = () => Array.from(document.querySelectorAll('.review-comment')).map((el) => el.textContent);

describe('TeacherDetailView extras', () => {
    beforeEach(() => {
        mockedVote.mockReset();
        mockedSummary.mockReset();
        mockedSummary.mockResolvedValue({ data: { available: false, reason: 'busy' } } as ApiResult);
    });

    it('offers WhatsApp and copy-link sharing for the teacher page', () => {
        renderView(makeTeacher());
        const wa = screen.getByRole('link', { name: /whatsapp/i }) as HTMLAnchorElement;
        expect(wa.href.startsWith('https://wa.me/?text=')).toBe(true);
        const text = decodeURIComponent(wa.href.split('text=')[1]);
        expect(text).toContain('Waqar Ashiq');
        expect(text).toContain('/teacher/7');
        expect(wa.target).toBe('_blank');
        expect(screen.getByRole('button', { name: /copy link/i })).toBeTruthy();
    });

    it('marks a review helpful optimistically and keeps the server count', async () => {
        let resolve: (v: ApiResult) => void = () => {};
        mockedVote.mockReturnValue(new Promise((r) => { resolve = r; }));
        renderView(makeTeacher());
        const card = screen.getByText('Newest review.').closest('article') as HTMLElement;
        const btn = within(card).getByRole('button', { name: /helpful/i });
        expect(btn.getAttribute('aria-pressed')).toBe('false');

        fireEvent.click(btn);
        expect(mockedVote).toHaveBeenCalledWith(2, true);
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        expect(btn.textContent).toContain('1');

        resolve({ data: { voted: true, helpful_count: 4 } } as ApiResult);
        await waitFor(() => expect(btn.textContent).toContain('4'));
    });

    it('undoes an existing vote and rolls back on failure', async () => {
        mockedVote.mockRejectedValue({ response: { data: { error: 'Too many votes.' } } });
        const props = renderView(makeTeacher());
        const card = screen.getByText('Middle review.').closest('article') as HTMLElement;
        const btn = within(card).getByRole('button', { name: /helpful/i });
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        fireEvent.click(btn);
        expect(mockedVote).toHaveBeenCalledWith(3, false);
        await waitFor(() => expect(props.showToast).toHaveBeenCalledWith('Too many votes.', 'error'));
        expect(btn.getAttribute('aria-pressed')).toBe('true');
        expect(btn.textContent).toContain('2');
    });

    it('sorts newest first when "Newest" is chosen', () => {
        renderView(makeTeacher());
        expect(commentsInOrder()).toEqual(['Newest review.', 'Middle review.', 'Oldest but most helpful.']);
    });

    it('defaults to "Most helpful" and keeps the server order', () => {
        renderView(makeTeacher({ review_sort: undefined }));
        const select = screen.getByRole('combobox', { name: /sort reviews/i }) as HTMLSelectElement;
        expect(select.value).toBe('helpful');
        expect(select.options[0].value).toBe('helpful');
        expect(commentsInOrder()).toEqual(['Oldest but most helpful.', 'Newest review.', 'Middle review.']);
    });

    it('does not re-sort the helpful order client-side', () => {
        const t = makeTeacher({ review_sort: 'helpful' });
        renderView(t);
        expect(commentsInOrder()).toEqual(['Oldest but most helpful.', 'Newest review.', 'Middle review.']);
        expect((screen.getByRole('combobox', { name: /sort reviews/i }) as HTMLSelectElement).value).toBe('helpful');
    });

    it('asks for a new sort or course filter', () => {
        const props = renderView(makeTeacher());
        fireEvent.change(screen.getByRole('combobox', { name: /sort reviews/i }), { target: { value: 'helpful' } });
        expect(props.onChangeReviewQuery).toHaveBeenLastCalledWith({ sort: 'helpful', course: null });

        fireEvent.click(screen.getByRole('button', { name: /calculus i/i }));
        expect(props.onChangeReviewQuery).toHaveBeenLastCalledWith({ sort: 'newest', course: 'Calculus I' });
    });

    it('shows the active course, its count and a way back to all courses', () => {
        const t = makeTeacher({
            review_course: 'Calculus I',
            filtered_reviews: 2,
            review_pagination: { page: 1, limit: 50, total: 2, totalPages: 1 },
            reviews: makeTeacher().reviews.slice(0, 2),
        });
        const props = renderView(t, { onLoadMoreReviews: vi.fn() });
        expect(screen.getByRole('button', { name: /calculus i/i }).getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByText(/2 of 3/)).toBeTruthy();
        // All of the filtered reviews are loaded: no "load more" for the 3rd overall review.
        expect(screen.queryByRole('button', { name: /load more reviews/i })).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: 'Sab courses' }));
        expect(props.onChangeReviewQuery).toHaveBeenLastCalledWith({ sort: 'newest', course: null });
    });

    it('renders the AI summary with its disclaimer', async () => {
        mockedSummary.mockResolvedValue({
            data: { available: true, overview: 'Zyada tar students khush hain.', pros: ['Concepts clear'], cons: ['Quizzes mushkil'], review_count: 3, generated_at: '2026-10-27T00:00:00Z' },
        } as ApiResult);
        renderView(makeTeacher());
        expect(await screen.findByText('Zyada tar students khush hain.')).toBeTruthy();
        expect(screen.getByText('Concepts clear')).toBeTruthy();
        expect(screen.getByText('Quizzes mushkil')).toBeTruthy();
        expect(screen.getByText(/ghalti ho sakti hai/)).toBeTruthy();
        expect(mockedSummary).toHaveBeenCalledWith(7);
    });

    it('does not ask for a summary with fewer than 3 reviews and hides it when unavailable', async () => {
        renderView(makeTeacher({ total_reviews: 2, review_count: 2, reviews: makeTeacher().reviews.slice(0, 2) }));
        expect(mockedSummary).not.toHaveBeenCalled();
        expect(screen.queryByText(/AI summary/)).toBeNull();
    });
});
