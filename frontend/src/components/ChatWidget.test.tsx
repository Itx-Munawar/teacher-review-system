import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatWidget from './ChatWidget';
import { sendChatMessage } from '../services/api';

vi.mock('../services/api', () => ({
    sendChatMessage: vi.fn(),
}));

const mockedSend = vi.mocked(sendChatMessage);
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
});
