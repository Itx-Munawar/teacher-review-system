import React, { useState, useEffect, useCallback } from 'react';
import { getTeacherQuestions, submitQuestion, submitAnswer, Question } from '../services/api';

interface QASectionProps {
    teacherId: number;
    teacherName: string;
}

const QASection: React.FC<QASectionProps> = ({ teacherId, teacherName }) => {
    const [questions, setQuestions] = useState<Question[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAskForm, setShowAskForm] = useState(false);
    const [questionText, setQuestionText] = useState('');
    const [answerTexts, setAnswerTexts] = useState<Record<number, string>>({});
    const [openAnswerForms, setOpenAnswerForms] = useState<Record<number, boolean>>({});
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const loadQuestions = useCallback(() => {
        setLoading(true);
        getTeacherQuestions(teacherId).then((res) => {
            setQuestions(res.data || []);
        }).catch(() => {
            setQuestions([]);
        }).finally(() => setLoading(false));
    }, [teacherId]);

    useEffect(() => {
        loadQuestions();
    }, [loadQuestions]);

    const handleAsk = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!questionText.trim()) return;
        setSubmitting(true);
        setError('');
        setSuccess('');
        try {
            await submitQuestion({ teacher_id: teacherId, question: questionText.trim() });
            setQuestionText('');
            setShowAskForm(false);
            setSuccess('Question posted! Other students can now answer it.');
            loadQuestions();
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to post question');
        } finally {
            setSubmitting(false);
        }
    };

    const handleAnswer = async (questionId: number) => {
        const answer = (answerTexts[questionId] || '').trim();
        if (!answer) return;
        setSubmitting(true);
        setError('');
        setSuccess('');
        try {
            await submitAnswer(questionId, answer);
            setAnswerTexts(prev => ({ ...prev, [questionId]: '' }));
            setOpenAnswerForms(prev => ({ ...prev, [questionId]: false }));
            setSuccess('Answer posted!');
            loadQuestions();
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to post answer');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="qa-section">
            <div className="qa-header">
                <h3>❓ Ask about {teacherName}</h3>
                {!showAskForm ? (
                    <button onClick={() => setShowAskForm(true)} className="btn-write-review qa-ask-btn">
                        + Ask a Question
                    </button>
                ) : (
                    <button onClick={() => setShowAskForm(false)} className="btn-cancel qa-ask-btn">
                        Cancel
                    </button>
                )}
            </div>

            {error && <div className="error-message">{error}</div>}
            {success && <div className="success-message" role="status">{success}</div>}

            {showAskForm && (
                <form onSubmit={handleAsk} className="review-form-container qa-form">
                    <label className="qa-label">💬 Your Question</label>
                    <div className="qa-input-row">
                        <textarea
                            rows={2}
                            value={questionText}
                            onChange={(e) => setQuestionText(e.target.value)}
                            placeholder={`e.g. Is attendance strict in ${teacherName}'s class?`}
                            required
                            aria-label="Your question"
                            className="qa-landscape-input"
                        />
                        <button type="submit" disabled={submitting} className="btn-submit qa-submit">
                            {submitting ? 'Posting...' : 'Post Question'}
                        </button>
                    </div>
                </form>
            )}

            {loading ? (
                <p className="qa-empty">Loading questions...</p>
            ) : questions.length === 0 ? (
                <p className="qa-empty">No questions yet. Ask other students about this teacher!</p>
            ) : (
                <div className="qa-list">
                    {questions.map((q) => (
                        <div key={q.id} className="qa-item">
                            <div className="qa-question">
                                <span className="qa-q-badge">Q</span>
                                <p className="qa-question-text">{q.question}</p>
                                <span className="review-date">📅 {new Date(q.created_at).toLocaleDateString()}</span>
                            </div>
                            {q.answers.length > 0 && (
                                <div className="qa-answers">
                                    {q.answers.map((a) => (
                                        <div key={a.id} className="qa-answer">
                                            <span className="qa-a-badge">A</span>
                                            <p className="qa-answer-text">{a.answer}</p>
                                            <span className="review-date">📅 {new Date(a.created_at).toLocaleDateString()}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {openAnswerForms[q.id] ? (
                                <div className="qa-answer-form">
                                    <textarea
                                        rows={2}
                                        value={answerTexts[q.id] || ''}
                                        onChange={(e) => setAnswerTexts(prev => ({ ...prev, [q.id]: e.target.value }))}
                                        placeholder="Share what you know..."
                                        aria-label="Your answer"
                                    />
                                    <div className="qa-answer-form-actions">
                                        <button onClick={() => handleAnswer(q.id)} disabled={submitting} className="btn-submit">
                                            {submitting ? 'Posting...' : 'Post Answer'}
                                        </button>
                                        <button
                                            onClick={() => setOpenAnswerForms(prev => ({ ...prev, [q.id]: false }))}
                                            className="btn-cancel"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setOpenAnswerForms(prev => ({ ...prev, [q.id]: true }))}
                                    className="qa-reply-btn"
                                >
                                    💬 Answer
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default QASection;
