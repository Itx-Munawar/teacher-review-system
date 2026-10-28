import { describe, it, expect, vi } from 'vitest';
import React, { useRef, useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ReviewTopicChips, { appendTopic, REVIEW_TOPICS } from './ReviewTopicChips';

const Harness: React.FC<{ initial?: string; max?: number }> = ({ initial = '', max = 1000 }) => {
    const [value, setValue] = useState(initial);
    const ref = useRef<HTMLTextAreaElement>(null);
    return (
        <>
            <textarea aria-label="review" ref={ref} value={value} onChange={(e) => setValue(e.target.value)} />
            <ReviewTopicChips value={value} maxLength={max} onChange={setValue} textareaRef={ref} />
        </>
    );
};

const box = () => screen.getByLabelText('review') as HTMLTextAreaElement;

describe('ReviewTopicChips', () => {
    it('starts a line for the tapped topic and puts the caret after it', () => {
        vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 0; });
        render(<Harness />);
        fireEvent.click(screen.getByRole('button', { name: /add a line about grading/i }));
        expect(box().value).toBe('Grading: ');
        expect(document.activeElement).toBe(box());
        expect(box().selectionStart).toBe('Grading: '.length);

        fireEvent.click(screen.getByRole('button', { name: /add a line about attendance/i }));
        expect(box().value).toBe('Grading:\nAttendance: ');
    });

    it('ticks topics the review already covers, in English or Roman Urdu', () => {
        render(<Harness initial="Sir concepts achay se samjhate hain, marks bhi achay dete hain. Attendance strict." />);
        const covered = screen.getAllByRole('button').filter((b) => b.classList.contains('is-covered')).map((b) => b.textContent);
        expect(covered).toEqual(['✓Teaching style', '✓Grading', '✓Attendance', '✓Behaviour']);
    });

    it('never pushes the review past the length limit', () => {
        expect(appendTopic('x'.repeat(995), 'Grading: ', 1000)).toBe('x'.repeat(995));
        expect(appendTopic('Good teacher.  ', 'Exams: ', 1000)).toBe('Good teacher.\nExams: ');
    });

    it('offers the topics students most often leave out', () => {
        expect(REVIEW_TOPICS.map((t) => t.label)).toEqual(['Teaching style', 'Grading', 'Attendance', 'Quizzes & assignments', 'Exams', 'Behaviour']);
    });
});
