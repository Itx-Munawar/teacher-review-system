import React, { useCallback, useEffect, useState } from 'react';
import { getAllQuestions, submitAnswer, BoardQuestion } from '../services/api';
import Icon from './Icon';
import EmptyState from './EmptyState';
import type { Teacher } from '../types';

const PAGE_SIZE = 15;

interface QuestionsViewProps {
    /** Open a teacher's profile (the card links through to the teacher page). */
    onOpenTeacher: (teacher: Teacher) => void;
    /** Leave the board and return to the teacher list. */
    onBack: () => void;
}

/**
 * Site-wide Q&A board: every approved question, newest first, labelled with the
 * teacher it belongs to. Anyone can post an answer (subject to moderation).
 */
const QuestionsView: React.FC<QuestionsViewProps> = ({ onOpenTeacher, onBack }) => {
    const [questions, setQuestions] = useState<BoardQuestion[]>([]);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [answerTexts, setAnswerTexts] = useState<Record<number, string>>({});
    const [openAnswerForms, setOpenAnswerForms] = useState<Record<number, boolean>>({});
    const [submitting, setSubmitting] = useState(false);

    const load = useCallback((nextPage: number) => {
        if (nextPage === 1) setLoading(true);
        else setLoadingMore(true);
        getAllQuestions(nextPage, PAGE_SIZE)
            .then((res) => {
                const data: BoardQuestion[] = res.data?.questions || [];
                setQuestions((prev) => (nextPage === 1 ? data : [...prev, ...data]));
                setPage(res.data?.pagination?.page || nextPage);
                setTotalPages(res.data?.pagination?.totalPages || 1);
                setTotal(res.data?.pagination?.total ?? data.length);
                setError('');
            })
            .catch(() => setError('Could not load questions. Please try again.'))
            .finally(() => {
                setLoading(false);
                setLoadingMore(false);
            });
    }, []);

    useEffect(() => {
        load(1);
    }, [load]);

    const handleAnswer = async (questionId: number) => {
        const answer = (answerTexts[questionId] || '').trim();
        if (!answer) return;
        setSubmitting(true);
        setError('');
        setSuccess('');
        try {
            const res = await submitAnswer(questionId, answer);
            setAnswerTexts((prev) => ({ ...prev, [questionId]: '' }));
            setOpenAnswerForms((prev) => ({ ...prev, [questionId]: false }));
            setSuccess(res.data?.pending
                ? 'Answer received - it will be posted once approved.'
                : 'Answer posted!');
        } catch (err) {
            const axiosErr = err as { response?: { data?: { error?: string } } };
            setError(axiosErr.response?.data?.error || 'Failed to post answer');
        } finally {
            setSubmitting(false);
        }
    };

    const openTeacher = (q: BoardQuestion) => {
        onOpenTeacher({
            id: q.teacher_id,
            name: q.teacher_name,
            department: q.teacher_department,
            review_count: 0
        });
    };

    return (
        <div className="questions-view page-enter">
            <div className="questions-view-hero">
                <button type="button" onClick={onBack} className="back-button">
                    ← Back to teachers
                </button>
                <p className="questions-view-eyebrow">UMT · Community Q&amp;A</p>
                <h1 className="questions-view-title">
                    <Icon name="message-square" size={26} />
                    <span>Questions &amp; answers</span>
                </h1>
                <p className="questions-view-lead">
                    Answer what fellow students are asking about their professors. Every answer is
                    reviewed by a moderator before it appears.
                </p>
                {!loading && total > 0 && (
                    <p className="questions-view-count">
                        {total} open question{total !== 1 ? 's' : ''} across all teachers
                    </p>
                )}
            </div>

            {error && <div className="error-message" role="alert">{error}</div>}
            {success && <div className="success-message" role="status">{success}</div>}

            {loading ? (
                <p className="qa-empty">Loading questions...</p>
            ) : questions.length === 0 ? (
                <EmptyState
                    icon="help"
                    title="No questions yet"
                    message="Once students ask about a teacher, their questions appear here."
                />
            ) : (
                <div className="qa-list questions-list">
                    {questions.map((q) => (
                        <article key={q.id} className="qa-item question-card">
                            <button
                                type="button"
                                className="question-teacher"
                                onClick={() => openTeacher(q)}
                                title={`Open ${q.teacher_name}`}
                            >
                                <span className="question-teacher-avatar" aria-hidden="true">
                                    {q.teacher_name.charAt(0)}
                                </span>
                                <span className="question-teacher-text">
                                    <span className="question-teacher-name">{q.teacher_name}</span>
                                    <span className="question-teacher-dept">{q.teacher_department}</span>
                                </span>
                                <Icon name="chevron-left" size={16} className="question-teacher-arrow" />
                            </button>

                            <div className="qa-question">
                                <span className="qa-q-badge">Q</span>
                                <p className="qa-question-text">{q.question}</p>
                                <span className="review-date">
                                    <Icon name="calendar" size={13} /> {new Date(q.created_at).toLocaleDateString()}
                                </span>
                            </div>

                            {q.answers.length > 0 && (
                                <div className="qa-answers">
                                    {q.answers.map((a) => (
                                        <div key={a.id} className="qa-answer">
                                            <span className="qa-a-badge">A</span>
                                            <p className="qa-answer-text">{a.answer}</p>
                                            <span className="review-date">
                                                <Icon name="calendar" size={13} /> {new Date(a.created_at).toLocaleDateString()}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {openAnswerForms[q.id] ? (
                                <div className="qa-answer-form">
                                    <section className="form-section" aria-label="Your answer">
                                        <div className="form-section-head">
                                            <span className="form-section-num">1</span>
                                            <h4 className="form-section-title">Your Answer</h4>
                                            <span className="form-section-hint">required</span>
                                        </div>
                                        <textarea
                                            rows={3}
                                            value={answerTexts[q.id] || ''}
                                            onChange={(e) => setAnswerTexts((prev) => ({ ...prev, [q.id]: e.target.value }))}
                                            placeholder="Share what you know..."
                                            aria-label="Your answer"
                                        />
                                    </section>
                                    <div className="qa-answer-form-actions">
                                        <button
                                            type="button"
                                            onClick={() => handleAnswer(q.id)}
                                            disabled={submitting}
                                            className="btn-submit"
                                        >
                                            {submitting ? 'Posting...' : 'Post Answer'}
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setOpenAnswerForms((prev) => ({ ...prev, [q.id]: false }))}
                                            className="btn-cancel"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setOpenAnswerForms((prev) => ({ ...prev, [q.id]: true }))}
                                    className="qa-reply-btn"
                                >
                                    <Icon name="message-circle" size={15} />
                                    <span>Answer</span>
                                </button>
                            )}
                        </article>
                    ))}

                    {page < totalPages && (
                        <div className="questions-load-more">
                            <button
                                type="button"
                                className="load-more-btn"
                                onClick={() => load(page + 1)}
                                disabled={loadingMore}
                            >
                                {loadingMore ? 'Loading more...' : 'Load more questions'}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default QuestionsView;
