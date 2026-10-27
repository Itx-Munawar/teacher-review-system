import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeacherDetailView from './TeacherDetailView';
import { replyToReview } from '../services/api';
import type { TeacherDetail } from '../types';

vi.mock('../services/api', () => ({
    replyToReview: vi.fn(),
}));
// Render lazily mounted sections straight away and keep Q&A out of the way.
vi.mock('./LazySection', () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./QASection', () => ({ default: () => null }));

const mockedReply = vi.mocked(replyToReview);

const teacher: TeacherDetail = {
    id: 5,
    name: 'Ayesha Khan',
    department: 'School of Science',
    review_count: 2,
    total_reviews: 2,
    reviews: [
        {
            id: 11,
            teacher_id: 5,
            comment: 'Explains every concept clearly.',
            user_name: 'Ali',
            created_at: '2026-10-01T10:00:00Z',
            replies: [
                { id: 1, review_id: 11, reply: 'Agreed, great notes too.', user_name: 'Hamza', created_at: '2026-10-02T10:00:00Z' },
            ],
        },
        {
            id: 12,
            teacher_id: 5,
            comment: 'Strict about attendance.',
            user_name: 'Anonymous',
            created_at: '2026-09-01T10:00:00Z',
            replies: [],
        },
    ],
};

const renderView = (showToast = vi.fn()) => {
    render(
        <TeacherDetailView
            selectedTeacher={teacher}
            relatedTeachers={[]}
            onShowReviewForm={vi.fn()}
            onClearSelectedTeacher={vi.fn()}
            onTeacherClick={vi.fn()}
            showToast={showToast}
        />
    );
    return showToast;
};

describe('TeacherDetailView replies', () => {
    beforeEach(() => {
        mockedReply.mockReset();
    });

    it('shows approved replies under their review and no report button', () => {
        renderView();
        expect(screen.getByText('Agreed, great notes too.')).toBeTruthy();
        expect(screen.getByText('Hamza')).toBeTruthy();
        expect(screen.getByRole('button', { name: /reply to the review by ali/i }).textContent).toContain('(1)');
        expect(screen.queryByText(/report/i)).toBeNull();
    });

    it('sends a reply with the optional name and confirms it is pending', async () => {
        mockedReply.mockResolvedValue({ data: { success: true, pending: true } } as Awaited<ReturnType<typeof replyToReview>>);
        const toast = renderView();
        fireEvent.click(screen.getByRole('button', { name: /reply to the review by anonymous/i }));

        const send = screen.getByRole('button', { name: 'Send reply' }) as HTMLButtonElement;
        expect(send.disabled).toBe(true);
        fireEvent.change(screen.getByRole('textbox', { name: /reply to the review by anonymous/i }), { target: { value: '  Not that strict actually.  ' } });
        fireEvent.change(screen.getByRole('textbox', { name: /your name/i }), { target: { value: 'Sara' } });
        expect(send.disabled).toBe(false);
        fireEvent.click(send);

        await waitFor(() => expect(mockedReply).toHaveBeenCalledWith(12, 'Not that strict actually.', 'Sara'));
        expect(await screen.findByText(/reply sent/i)).toBeTruthy();
        expect(toast).toHaveBeenCalledWith(expect.stringMatching(/moderator approves/i), 'success');
    });

    it('surfaces the server error and keeps the form open', async () => {
        mockedReply.mockRejectedValue({ response: { data: { error: 'Too many replies. Please try again later.' } } });
        const toast = renderView();
        fireEvent.click(screen.getByRole('button', { name: /reply to the review by ali/i }));
        fireEvent.change(screen.getByRole('textbox', { name: /reply to the review by ali/i }), { target: { value: 'Same experience here' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

        await waitFor(() => expect(toast).toHaveBeenCalledWith('Too many replies. Please try again later.', 'error'));
        expect(screen.getByRole('button', { name: 'Send reply' })).toBeTruthy();
    });
});
