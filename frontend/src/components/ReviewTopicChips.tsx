import React from 'react';

/**
 * "What to write about" chips under the review box. Tapping one starts a new
 * line such as "Grading: " so short reviews ("best teacher") become useful
 * ones - which also makes the AI summary and the chat assistant better.
 * A topic the text already covers (in English or Roman Urdu) gets a tick.
 */
export interface ReviewTopic {
    id: string;
    label: string;
    /** Text inserted into the review. */
    prefix: string;
    /** Words that mean the review already talks about this topic. */
    covered: RegExp;
}

export const REVIEW_TOPICS: ReviewTopic[] = [
    { id: 'teaching', label: 'Teaching style', prefix: 'Teaching: ', covered: /\b(teach\w*|parh\w*|padh\w*|samjh\w*|explain\w*|concept\w*|lecture\w*|andaaz|slides)/i },
    { id: 'grading', label: 'Grading', prefix: 'Grading: ', covered: /\b(grad\w*|marks?|marking|numbers?|gpa|curve|relative|absolute)\b/i },
    { id: 'attendance', label: 'Attendance', prefix: 'Attendance: ', covered: /\b(attendance|haazri|hazri|absents?|proxy)\b/i },
    { id: 'workload', label: 'Quizzes & assignments', prefix: 'Quizzes/assignments: ', covered: /\b(quiz\w*|assignments?|projects?|homework|presentations?|labs?)\b/i },
    { id: 'exams', label: 'Exams', prefix: 'Exams: ', covered: /\b(exams?|papers?|mids?|midterms?|finals?|imtehan|sessionals?)\b/i },
    { id: 'behaviour', label: 'Behaviour', prefix: 'Behaviour: ', covered: /\b(behaviou?r\w*|rawaiya|rawaya|attitude|friendly|strict|rude|polite|cooperative|helpful|respect\w*|akhlaq)\b/i },
];

/** The review text with `prefix` started on a new line, within `maxLength`. */
export const appendTopic = (text: string, prefix: string, maxLength: number): string => {
    const base = text.replace(/\s+$/, '');
    const next = base ? `${base}\n${prefix}` : prefix;
    return next.length <= maxLength ? next : text;
};

interface Props {
    value: string;
    maxLength: number;
    onChange: (next: string) => void;
    /** The textarea, so the caret can be put right after the inserted label. */
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

const ReviewTopicChips: React.FC<Props> = ({ value, maxLength, onChange, textareaRef }) => {
    const add = (topic: ReviewTopic) => {
        const next = appendTopic(value, topic.prefix, maxLength);
        if (next === value) return;
        onChange(next);
        // After React has rendered the new value.
        requestAnimationFrame(() => {
            const el = textareaRef.current;
            if (!el) return;
            el.focus();
            el.setSelectionRange(next.length, next.length);
            el.scrollTop = el.scrollHeight;
        });
    };

    return (
        <div className="review-topics">
            <p className="review-topics-hint" id="review-topics-hint">Not sure what to write? Tap a topic:</p>
            <div className="review-topics-list" role="group" aria-describedby="review-topics-hint">
                {REVIEW_TOPICS.map((topic) => {
                    const done = topic.covered.test(value);
                    return (
                        <button
                            key={topic.id}
                            type="button"
                            className={`review-topic-chip${done ? ' is-covered' : ''}`}
                            onClick={() => add(topic)}
                            aria-label={done ? `${topic.label} (already mentioned) - add a line` : `Add a line about ${topic.label.toLowerCase()}`}
                        >
                            <span aria-hidden="true">{done ? '✓' : '+'}</span>
                            {topic.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default ReviewTopicChips;
