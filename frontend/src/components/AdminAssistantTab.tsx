import React, { useCallback, useEffect, useState } from 'react';
import { getChatInsights, deleteChatFeedback, type ChatInsights, type ChatInsightsFeedback } from '../services/api';
import './AdminAssistantTab.css';

type Range = 7 | 30 | 90;

const LABELS: Record<string, string> = {
    general: 'General / recommendation',
    focused: 'One teacher',
    site: 'Site help',
    english: 'English',
    'roman-urdu': 'Roman Urdu',
    urdu: 'Urdu script',
    grading: 'Grading',
    attendance: 'Attendance',
    teaching: 'Teaching',
    exams: 'Exams & quizzes',
    assignments: 'Assignments & projects',
    behaviour: 'Behaviour',
};
const label = (key: string) => LABELS[key] || key;

const total = (rec?: Record<string, number>) => Object.values(rec || {}).reduce((a, b) => a + b, 0);

/** Horizontal bars for one breakdown (language, aspect, ...). */
const Breakdown: React.FC<{ title: string; data?: Record<string, number>; empty: string }> = ({ title, data, empty }) => {
    const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map(([, n]) => n));
    return (
        <div className="aa-card">
            <h4>{title}</h4>
            {entries.length === 0 ? <p className="aa-muted">{empty}</p> : (
                <ul className="aa-bars">
                    {entries.map(([key, n]) => (
                        <li key={key}>
                            <span className="aa-bar-label">{label(key)}</span>
                            <span className="aa-bar-track"><span className="aa-bar-fill" style={{ width: `${(n / max) * 100}%` }} /></span>
                            <span className="aa-bar-count">{n}</span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

const FeedbackItem: React.FC<{ item: ChatInsightsFeedback; onDelete: (id: number) => void; deleting: boolean }> = ({ item, onDelete, deleting }) => {
    const [expanded, setExpanded] = useState(false);
    // The widget renders **bold**; plain text here.
    const answer = item.answer.replace(/\*\*/g, '');
    const long = answer.length > 280;
    return (
        <li className={`aa-feedback ${item.rating === -1 ? 'aa-feedback-down' : 'aa-feedback-up'}`}>
            <div className="aa-feedback-head">
                <span className="aa-feedback-rating" aria-label={item.rating === -1 ? 'Not helpful' : 'Helpful'}>
                    {item.rating === -1 ? '👎' : '👍'}
                </span>
                <small className="aa-muted">{new Date(item.updated_at || item.created_at).toLocaleString()}</small>
                {item.teachers.length > 0 && (
                    <small className="aa-feedback-teachers">
                        {item.teachers.map((t) => (
                            <a key={t.id} href={`/teacher/${t.id}`} target="_blank" rel="noopener noreferrer">{t.name}</a>
                        ))}
                    </small>
                )}
                <button
                    type="button"
                    className="delete-btn aa-feedback-delete"
                    onClick={() => onDelete(item.id)}
                    disabled={deleting}
                    aria-label="Delete this rating"
                >
                    {deleting ? '…' : 'Delete'}
                </button>
            </div>
            <p className="aa-feedback-q"><strong>Q:</strong> {item.question}</p>
            <p className="aa-feedback-a">
                <strong>A:</strong> {long && !expanded ? `${answer.slice(0, 280)}…` : answer}
                {long && (
                    <button type="button" className="aa-link-btn" onClick={() => setExpanded((v) => !v)}>
                        {expanded ? 'Show less' : 'Show all'}
                    </button>
                )}
            </p>
            {item.comment && <p className="aa-feedback-comment"><strong>What was wrong:</strong> {item.comment}</p>}
        </li>
    );
};

/** Admin "Assistant" tab: what the review assistant is asked and how it is rated. */
const AdminAssistantTab: React.FC = () => {
    const [range, setRange] = useState<Range>(30);
    const [data, setData] = useState<ChatInsights | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [filter, setFilter] = useState<'all' | 'down' | 'up'>('all');

    const load = useCallback(async (days: Range) => {
        setLoading(true);
        setError('');
        try {
            const res = await getChatInsights(days);
            setData(res.data);
        } catch {
            setError('Could not load assistant insights.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(range); }, [range, load]);

    const remove = async (id: number) => {
        if (!window.confirm('Delete this rating and the question/answer stored with it?')) return;
        setDeletingId(id);
        try {
            await deleteChatFeedback(id);
            setData((d) => {
                if (!d) return d;
                const removed = d.feedback?.find((f) => f.id === id);
                const ratings = { ...(d.ratings || { up: 0, down: 0 }) };
                if (removed?.rating === 1) ratings.up = Math.max(0, ratings.up - 1);
                if (removed?.rating === -1) ratings.down = Math.max(0, ratings.down - 1);
                return { ...d, ratings, feedback: (d.feedback || []).filter((f) => f.id !== id) };
            });
        } catch {
            window.alert('Could not delete the rating.');
        } finally {
            setDeletingId(null);
        }
    };

    const requests = data?.requests || {};
    const questions = (requests.answered || 0) + (requests.cached || 0);
    const failed = (requests.busy || 0) + (requests.error || 0);
    const limited = (requests.rate_limited || 0) + (requests.daily_limit || 0);
    const ratings = data?.ratings || { up: 0, down: 0 };
    const rated = ratings.up + ratings.down;
    const byDay = data?.byDay || [];
    const maxDay = Math.max(1, ...byDay.map((d) => d.questions));
    const feedback = (data?.feedback || []).filter((f) => filter === 'all' || (filter === 'down' ? f.rating === -1 : f.rating === 1));

    return (
        <div className="admin-section aa-root">
            <div className="aa-header">
                <div>
                    <h3>Review assistant</h3>
                    <p className="aa-muted">
                        Normal questions are only counted (type, language, topic, teacher), and their text is never stored.
                        The text is saved only when a student rates an answer. Everything older than 90 days is deleted automatically.
                    </p>
                </div>
                <div className="aa-range" role="group" aria-label="Time range">
                    {([7, 30, 90] as Range[]).map((d) => (
                        <button key={d} type="button" className={range === d ? 'aa-range-on' : ''} onClick={() => setRange(d)} aria-pressed={range === d}>
                            {d} days
                        </button>
                    ))}
                </div>
            </div>

            {error && <p className="aa-error">{error} <button type="button" className="aa-link-btn" onClick={() => load(range)}>Retry</button></p>}
            {loading && !data && <p className="aa-muted">Loading…</p>}
            {data && !data.available && <p className="aa-muted">Assistant statistics are not available yet (the database tables are still being created).</p>}

            {data?.available && (
                <>
                    <div className="aa-stats">
                        <div className="aa-stat"><span className="aa-stat-num">{questions}</span><span>questions answered</span></div>
                        <div className="aa-stat"><span className="aa-stat-num">{requests.cached || 0}</span><span>served from cache</span></div>
                        <div className="aa-stat"><span className="aa-stat-num">{failed}</span><span>busy / failed</span></div>
                        <div className="aa-stat"><span className="aa-stat-num">{limited}</span><span>hit a rate limit</span></div>
                        <div className="aa-stat">
                            <span className="aa-stat-num">{rated ? `${Math.round((ratings.up / rated) * 100)}%` : '–'}</span>
                            <span>helpful ({ratings.up} 👍 · {ratings.down} 👎)</span>
                        </div>
                    </div>

                    <div className="aa-card">
                        <h4>Questions per day</h4>
                        <div className="aa-chart" role="img" aria-label={`Questions per day over the last ${data.days} days`}>
                            {byDay.map((d) => (
                                <div key={d.day} className="aa-chart-col" title={`${d.day}: ${d.questions}`}>
                                    <span className="aa-chart-bar" style={{ height: `${(d.questions / maxDay) * 100}%` }} />
                                </div>
                            ))}
                        </div>
                        <div className="aa-chart-axis aa-muted">
                            <span>{byDay[0]?.day}</span>
                            <span>{byDay[byDay.length - 1]?.day}</span>
                        </div>
                    </div>

                    <div className="aa-grid">
                        <Breakdown title="Kind of question" data={data.modes} empty="No questions yet." />
                        <Breakdown title="What students ask about" data={data.aspects} empty="No aspect detected yet." />
                        <Breakdown title="Language" data={data.languages} empty="No questions yet." />
                        <div className="aa-card">
                            <h4>Most asked-about teachers</h4>
                            {(data.topTeachers || []).length === 0 ? <p className="aa-muted">None yet.</p> : (
                                <ol className="aa-ranked">
                                    {(data.topTeachers || []).map((t) => (
                                        <li key={t.id}>
                                            <a href={`/teacher/${t.id}`} target="_blank" rel="noopener noreferrer">{t.name}</a>
                                            <small className="aa-muted"> {t.department}</small>
                                            <span className="aa-bar-count">{t.count}</span>
                                        </li>
                                    ))}
                                </ol>
                            )}
                        </div>
                        <div className="aa-card">
                            <h4>Courses &amp; departments asked about</h4>
                            {(data.topTopics || []).length === 0 ? <p className="aa-muted">None yet.</p> : (
                                <ol className="aa-ranked">
                                    {(data.topTopics || []).map((t) => (
                                        <li key={t.name}><span>{t.name}</span><span className="aa-bar-count">{t.count}</span></li>
                                    ))}
                                </ol>
                            )}
                        </div>
                        {total(data.models) > 0 && <Breakdown title="Gemini model used" data={data.models} empty="" />}
                    </div>

                    <div className="aa-feedback-header">
                        <h4>Rated answers</h4>
                        <div className="aa-range" role="group" aria-label="Filter ratings">
                            {(['all', 'down', 'up'] as const).map((f) => (
                                <button key={f} type="button" className={filter === f ? 'aa-range-on' : ''} onClick={() => setFilter(f)} aria-pressed={filter === f}>
                                    {f === 'all' ? 'All' : f === 'down' ? '👎 Not helpful' : '👍 Helpful'}
                                </button>
                            ))}
                        </div>
                    </div>
                    {feedback.length === 0 ? (
                        <p className="aa-muted">No rated answers in this period.</p>
                    ) : (
                        <ul className="aa-feedback-list">
                            {feedback.map((f) => (
                                <FeedbackItem key={f.id} item={f} onDelete={remove} deleting={deletingId === f.id} />
                            ))}
                        </ul>
                    )}
                </>
            )}
        </div>
    );
};

export default AdminAssistantTab;
