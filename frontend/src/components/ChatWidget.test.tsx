import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatWidget from './ChatWidget';
import { sendChatMessage, sendChatFeedback } from '../services/api';

vi.mock('../services/api', () => ({
    sendChatMessage: vi.fn(),
    sendChatFeedback: vi.fn(),
}));

const mockedSend = vi.mocked(sendChatMessage);
const mockedFeedback = vi.mocked(sendChatFeedback);
const signed = (reply: string, teachers = [] as { id: number; name: string; department: string }[]) =>
    Promise.resolve({ data: { reply, teachers, replyToken: '1790000000.tok' } } as Awaited<ReturnType<typeof sendChatMessage>>);
const ok = (reply: string, teachers = [] as { id: number; name: string; department: string }[]) =>
    Promise.resolve({ data: { reply, teachers } } as Awaited<ReturnType<typeof sendChatMessage>>);

const openAndAsk = (text: string) => {
    fireEvent.click(screen.getByRole('button', { name: /ask the review assistant/i }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
};

describe('ChatWidget', () => {
    beforeEach(() => {
        sessionStorage.clear();
        mockedSend.mockReset();
        mockedFeedback.mockReset();
        // jsdom has no layout; the list auto-scroll only needs these to exist.
        Element.prototype.scrollTo = vi.fn();
    });

    it('sends the question with the page teacher and shows teacher links', async () => {
        mockedSend.mockReturnValue(ok('**Waqar Ashiq** grades fairly.\n- Clear concepts', [{ id: 7, name: 'Waqar Ashiq', department: 'SST' }]));
        const onOpenTeacher = vi.fn();
        render(<ChatWidget pageTeacher={{ id: 7, name: 'Waqar Ashiq' }} onOpenTeacher={onOpenTeacher} />);
        openAndAsk('grading kesi hai?');

        expect(mockedSend).toHaveBeenCalledWith({ message: 'grading kesi hai?', history: [], teacherId: 7 });
        const chip = await screen.findByRole('button', { name: /waqar ashiq/i });
        expect(screen.getByText('Waqar Ashiq', { selector: 'strong' })).toBeInTheDocument();
        expect(screen.getByText('Clear concepts', { selector: 'li' })).toBeInTheDocument();
        fireEvent.click(chip);
        expect(onOpenTeacher).toHaveBeenCalledWith({ id: 7, name: 'Waqar Ashiq', department: 'SST' });
    });

    it('never interprets HTML coming back from the model', async () => {
        mockedSend.mockReturnValue(ok('<img src=x onerror="alert(1)"> <b>hi</b>'));
        const { container } = render(<ChatWidget pageTeacher={null} onOpenTeacher={() => {}} />);
        openAndAsk('hello');
        await screen.findByText(/onerror/);
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('b')).toBeNull();
    });

    it('sends earlier turns as history but not the greeting or errors', async () => {
        mockedSend
            .mockReturnValueOnce(ok('First answer'))
            .mockRejectedValueOnce({ response: { data: { error: 'Busy, try again.' } } })
            .mockReturnValueOnce(ok('Third answer'));
        render(<ChatWidget pageTeacher={null} onOpenTeacher={() => {}} />);
        openAndAsk('sir ali kese hain');
        await screen.findByText('First answer');

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'aur grading?' } });
        fireEvent.click(screen.getByRole('button', { name: 'Send' }));
        expect(await screen.findByText('Busy, try again.')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await screen.findByText('Third answer');
        expect(mockedSend).toHaveBeenLastCalledWith({
            message: 'aur grading?',
            history: [
                { role: 'user', text: 'sir ali kese hain' },
                { role: 'assistant', text: 'First answer' },
            ],
            teacherId: null,
        });
        expect(screen.queryByText('Busy, try again.')).toBeNull();
    });

    it('quietly retries once when the assistant is busy', async () => {
        mockedSend
            .mockRejectedValueOnce({ response: { data: { error: 'The assistant is busy right now.', code: 'busy' } } })
            .mockReturnValueOnce(ok('Answer after retry'));
        render(<ChatWidget pageTeacher={null} onOpenTeacher={() => {}} />);
        openAndAsk('hareem aslam?');
        expect(await screen.findByText('Answer after retry', {}, { timeout: 7000 })).toBeInTheDocument();
        expect(mockedSend).toHaveBeenCalledTimes(2);
        expect(screen.queryByText('The assistant is busy right now.')).toBeNull();
    }, 10000);

    it('offers a retry when the page reloaded mid-question', async () => {
        sessionStorage.setItem('trs-chat-v1', JSON.stringify([
            { id: 1, role: 'assistant', text: 'hi', local: true },
            { id: 2, role: 'user', text: 'umer usman?' },
        ]));
        mockedSend.mockReturnValue(ok('Umer answer'));
        render(<ChatWidget pageTeacher={null} onOpenTeacher={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: /ask the review assistant/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
        await waitFor(() => expect(screen.getByText('Umer answer')).toBeInTheDocument());
        expect(mockedSend).toHaveBeenCalledWith({ message: 'umer usman?', history: [], teacherId: null });
    });

    it('rates an answer, can switch, and sends an optional comment after thumbs-down', async () => {
        mockedSend.mockReturnValue(signed('He grades fairly.', [{ id: 7, name: 'Waqar Ashiq', department: 'SST' }]));
        mockedFeedback.mockResolvedValue({ data: { success: true } } as Awaited<ReturnType<typeof sendChatFeedback>>);
        render(<ChatWidget pageTeacher={null} onOpenTeacher={() => {}} />);
        openAndAsk('waqar ki grading?');
        await screen.findByText('He grades fairly.');
        expect(screen.getByText(/rating an answer shares it with the site admins/i)).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Helpful answer' }));
        await screen.findByText('Thanks for the feedback!');
        expect(mockedFeedback).toHaveBeenLastCalledWith({
            token: '1790000000.tok', question: 'waqar ki grading?', answer: 'He grades fairly.', teacherIds: [7], rating: 1,
        });
        expect(screen.getByRole('button', { name: 'Helpful answer' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.queryByPlaceholderText(/what was wrong/i)).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Not helpful answer' }));
        const box = await screen.findByPlaceholderText(/what was wrong/i);
        expect(mockedFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ rating: -1 }));
        fireEvent.change(box, { target: { value: 'It ignored attendance' } });
        fireEvent.submit(box.closest('form')!);
        await waitFor(() => expect(mockedFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ rating: -1, comment: 'It ignored attendance' })));
        await waitFor(() => expect(screen.queryByPlaceholderText(/what was wrong/i)).toBeNull());
    });

    it('shows an error and undoes the rating when saving fails', async () => {
        mockedSend.mockReturnValue(signed('Answer.'));
        mockedFeedback.mockRejectedValue(new Error('network'));
        render(<ChatWidget pageTeacher={null} onOpenTeacher={() => {}} />);
        openAndAsk('kon acha hai?');
        await screen.findByText('Answer.');
        fireEvent.click(screen.getByRole('button', { name: 'Not helpful answer' }));
        await screen.findByText(/could not save/i);
        expect(screen.getByRole('button', { name: 'Not helpful answer' })).toHaveAttribute('aria-pressed', 'false');
    });

    it('offers no rating buttons for answers without a token', async () => {
        mockedSend.mockReturnValue(ok('Old-style answer.'));
        render(<ChatWidget pageTeacher={null} onOpenTeacher={() => {}} />);
        openAndAsk('hello');
        await screen.findByText('Old-style answer.');
        expect(screen.queryByRole('button', { name: 'Helpful answer' })).toBeNull();
    });

    it('perches the cat on the mobile bottom nav, ducks on scroll and opens the chat on tap', async () => {
        const nav = document.createElement('nav');
        nav.className = 'bottom-nav';
        nav.innerHTML = '<button class="bottom-nav-item" data-key="ai">Ask AI</button>';
        document.body.appendChild(nav);
        try {
            const { container } = render(<ChatWidget pageTeacher={null} onOpenTeacher={() => {}} />);
            const perch = await waitFor(() => {
                const el = container.querySelector('.chat-cat-mobile');
                expect(el).not.toBeNull();
                return el as HTMLElement;
            });
            fireEvent.scroll(window);
            expect(perch.className).toContain('is-ducked');
            fireEvent.click(perch.querySelector('button')!);
            expect(container.querySelector('.chat-panel')).not.toBeNull();
            expect(container.querySelector('.chat-cat-mobile')).toBeNull();
        } finally {
            nav.remove();
        }
    });
});
