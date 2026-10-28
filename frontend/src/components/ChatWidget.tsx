import React, { useCallback, useEffect, useRef, useState } from 'react';
import { OPEN_CHAT_EVENT } from '../utils/chatEvents';
import ChatCat, { type CatMood } from './ChatCat';
import { sendChatMessage, sendChatFeedback, type ChatTeacherRef } from '../services/api';

/** Pause before the automatic retry of a busy/failed answer. */
export const CHAT_RETRY_DELAY_MS = 4000;
import Icon from './Icon';
import './ChatWidget.css';

interface ChatMessage {
    id: number;
    role: 'user' | 'assistant';
    text: string;
    teachers?: ChatTeacherRef[];
    /** Shown in the chat but never sent back to the server. */
    local?: boolean;
    error?: boolean;
    /** Assistant answers: the question it answered and the server's token for rating it. */
    question?: string;
    replyToken?: string;
    rating?: 1 | -1;
    feedback?: 'sending' | 'saved' | 'failed';
    commentSent?: boolean;
}

interface ChatWidgetProps {
    /** Teacher whose page is open, so "inki grading?" works without a name. */
    pageTeacher: { id: number; name: string } | null;
    onOpenTeacher: (teacher: ChatTeacherRef) => void;
    /** Lift the launcher above the compare bar while it is showing. */
    raised?: boolean;
}

const STORAGE_KEY = 'trs-chat-v1';
const MAX_LENGTH = 600;
const GREETING: ChatMessage = {
    id: 0,
    role: 'assistant',
    local: true,
    text: 'Assalam o Alaikum! Ask me about any UMT teacher: teaching style, grading, attendance, quizzes, or who to take for a course. I answer from student reviews. You can write in English or Roman Urdu.',
};

let nextId = Date.now();

const loadMessages = (): ChatMessage[] => {
    try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (Array.isArray(parsed) && parsed.length) {
            const msgs = parsed as ChatMessage[];
            // The page reloaded while a question was in flight: offer a retry instead of silence.
            if (msgs[msgs.length - 1].role === 'user') {
                msgs.push({ id: ++nextId, role: 'assistant', text: 'The page reloaded before the answer arrived. Please try again.', error: true });
            }
            return msgs;
        }
    } catch { /* storage unavailable or corrupt */ }
    return [GREETING];
};

/** **bold** inside a line. React escapes everything else. */
const renderInline = (line: string, keyPrefix: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, i) =>
        part.startsWith('**') && part.endsWith('**') && part.length > 4
            ? <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
            : <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>
    );

/** Paragraphs and "- " bullet lists; no HTML is ever interpreted. */
const renderRich = (text: string) => {
    const blocks: React.ReactNode[] = [];
    let bullets: string[] = [];
    const flush = () => {
        if (bullets.length) {
            const items = bullets;
            blocks.push(<ul key={`ul-${blocks.length}`}>{items.map((b, i) => <li key={i}>{renderInline(b, `li-${blocks.length}-${i}`)}</li>)}</ul>);
            bullets = [];
        }
    };
    text.split('\n').forEach((raw) => {
        const line = raw.trim();
        const bullet = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (bullet) { bullets.push(bullet[1]); return; }
        flush();
        if (line) blocks.push(<p key={`p-${blocks.length}`}>{renderInline(line.replace(/^#+\s*/, ''), `p-${blocks.length}`)}</p>);
    });
    flush();
    return blocks;
};

const CAT_HINT_KEY = 'trs_cat_hint';

const SparkIcon = () => (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        <path d="M12 7.5l.9 1.9 1.9.9-1.9.9-.9 1.9-.9-1.9-1.9-.9 1.9-.9z" fill="currentColor" stroke="none" />
    </svg>
);

const ThumbIcon = ({ down = false }: { down?: boolean }) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={down ? { transform: 'rotate(180deg)' } : undefined}>
        <path d="M7 10v12" />
        <path d="M15 5.88L14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z" />
    </svg>
);

const SendIcon = () => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M22 2L11 13" />
        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </svg>
);

const ChatWidget: React.FC<ChatWidgetProps> = ({ pageTeacher, onOpenTeacher, raised = false }) => {
    const [open, setOpen] = useState(false);
    const [messages, setMessages] = useState<ChatMessage[]>(loadMessages);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const listRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const launcherRef = useRef<HTMLButtonElement>(null);
    // When the compare bar is showing, sit just above it (its height varies with how many teachers are picked).
    const [raisedBottom, setRaisedBottom] = useState<number | null>(null);
    useEffect(() => {
        if (!raised) { setRaisedBottom(null); return; }
        let observer: ResizeObserver | null = null;
        const measure = () => {
            const bar = document.querySelector('.compare-bar');
            if (!bar) return;
            const top = bar.getBoundingClientRect().top;
            setRaisedBottom(Math.max(0, Math.round(window.innerHeight - top + 12)));
            if (!observer && typeof ResizeObserver !== 'undefined') {
                observer = new ResizeObserver(measure);
                observer.observe(bar);
            }
        };
        const frame = window.requestAnimationFrame(measure);
        window.addEventListener('resize', measure);
        return () => {
            window.cancelAnimationFrame(frame);
            window.removeEventListener('resize', measure);
            observer?.disconnect();
        };
    }, [raised]);

    // Cat mood: scans while an answer is on its way, smiles when it lands.
    const [happy, setHappy] = useState(false);
    const wasSendingRef = useRef(false);
    useEffect(() => {
        const last = messages[messages.length - 1];
        if (wasSendingRef.current && !sending && last && last.role === 'assistant' && !last.error) {
            setHappy(true);
            const t = window.setTimeout(() => setHappy(false), 1400);
            wasSendingRef.current = sending;
            return () => window.clearTimeout(t);
        }
        wasSendingRef.current = sending;
        return undefined;
    }, [sending, messages]);
    const catMood: CatMood = sending ? 'thinking' : happy ? 'happy' : 'idle';

    // One hello bubble per session, desktop only, if the visitor hasn't chatted yet.
    const [hint, setHint] = useState(false);
    useEffect(() => {
        if (open || messages.some((m) => m.role === 'user')) { setHint(false); return undefined; }
        try { if (sessionStorage.getItem(CAT_HINT_KEY)) return undefined; } catch { return undefined; }
        if (typeof window.matchMedia !== 'function' || !window.matchMedia('(min-width: 769px)').matches) return undefined;
        const show = window.setTimeout(() => {
            setHint(true);
            try { sessionStorage.setItem(CAT_HINT_KEY, '1'); } catch { /* ignore */ }
        }, 6000);
        const hide = window.setTimeout(() => setHint(false), 14000);
        return () => { window.clearTimeout(show); window.clearTimeout(hide); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    // The bottom nav and the home hero open the assistant from outside.
    useEffect(() => {
        const onOpen = () => setOpen(true);
        window.addEventListener(OPEN_CHAT_EVENT, onOpen);
        return () => window.removeEventListener(OPEN_CHAT_EVENT, onOpen);
    }, []);

    // Bumped by "New" so a late answer never lands in a fresh conversation.
    const conversationRef = useRef(0);

    useEffect(() => {
        try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30))); } catch { /* ignore */ }
    }, [messages]);

    // Keep the newest message in view.
    useEffect(() => {
        if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
    }, [messages, sending, open]);

    useEffect(() => {
        if (!open) return;
        const t = window.setTimeout(() => inputRef.current?.focus(), 60);
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('keydown', onKey);
        return () => { window.clearTimeout(t); window.removeEventListener('keydown', onKey); };
    }, [open]);

    // The sheet covers the page on phones: stop the page behind it scrolling.
    useEffect(() => {
        if (!open || window.innerWidth > 640) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [open]);

    const close = useCallback(() => {
        setOpen(false);
        launcherRef.current?.focus();
    }, []);

    const send = useCallback(async (text: string, base?: ChatMessage[]) => {
        const message = text.trim().slice(0, MAX_LENGTH);
        if (!message || sending) return;
        const before = base ?? messages;
        const userMsg: ChatMessage = { id: ++nextId, role: 'user', text: message };
        const history = before
            .filter((m) => !m.local && !m.error)
            .slice(-8)
            .map((m) => ({ role: m.role, text: m.text }));
        setMessages([...before, userMsg]);
        setInput('');
        setSending(true);
        const conversation = conversationRef.current;
        try {
            const payload = { message, history, teacherId: pageTeacher?.id ?? null };
            let res;
            try {
                res = await sendChatMessage(payload);
            } catch (firstErr) {
                // The free Gemini tier is bursty: one quiet retry after a short
                // pause usually succeeds, so only show an error if that fails too.
                const code = (firstErr as { response?: { data?: { code?: string } } }).response?.data?.code;
                if (code !== 'busy' && code !== 'upstream') throw firstErr;
                await new Promise((resolve) => setTimeout(resolve, CHAT_RETRY_DELAY_MS));
                if (conversation !== conversationRef.current) return;
                res = await sendChatMessage(payload);
            }
            if (conversation !== conversationRef.current) return;
            setMessages((prev) => [...prev, { id: ++nextId, role: 'assistant', text: res.data.reply, teachers: res.data.teachers, question: message, replyToken: res.data.replyToken }]);
        } catch (err) {
            const e = err as { response?: { data?: { error?: string } }; code?: string };
            const text = e.response?.data?.error
                || (e.code === 'ECONNABORTED' ? 'That took too long. Please try again.' : 'Could not reach the assistant. Check your connection and try again.');
            if (conversation !== conversationRef.current) return;
            setMessages((prev) => [...prev, { id: ++nextId, role: 'assistant', text, error: true }]);
        } finally {
            if (conversation === conversationRef.current) setSending(false);
        }
    }, [messages, sending, pageTeacher?.id]);

    const updateMessage = (id: number, patch: Partial<ChatMessage>) =>
        setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));

    // 👍/👎: a second tap on the other thumb changes the rating of the same answer.
    const rate = async (m: ChatMessage, rating: 1 | -1, comment?: string) => {
        if (!m.replyToken || !m.question) return;
        const previous = m.rating;
        updateMessage(m.id, { rating, feedback: 'sending' });
        try {
            await sendChatFeedback({
                token: m.replyToken,
                question: m.question,
                answer: m.text,
                teacherIds: (m.teachers || []).map((t) => t.id),
                rating,
                ...(comment ? { comment } : {}),
            });
            updateMessage(m.id, { feedback: 'saved', ...(comment ? { commentSent: true } : {}) });
        } catch {
            updateMessage(m.id, { rating: previous, feedback: 'failed' });
        }
    };

    const [commentDrafts, setCommentDrafts] = useState<Record<number, string>>({});

    const retry = useCallback(() => {
        // Drop the error and the question it answered, then ask again.
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (!lastUser) return;
        const idx = messages.lastIndexOf(lastUser);
        send(lastUser.text, messages.slice(0, idx));
    }, [messages, send]);

    const reset = () => {
        conversationRef.current += 1;
        setSending(false);
        setMessages([GREETING]);
        setInput('');
        inputRef.current?.focus();
    };

    const openTeacher = (t: ChatTeacherRef) => {
        onOpenTeacher(t);
        // On phones the sheet covers the page, so get out of the way.
        if (window.innerWidth <= 640) setOpen(false);
    };

    const onSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        send(input);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send(input);
        }
    };

    const firstName = pageTeacher ? pageTeacher.name.replace(/^(dr|prof|mr|mrs|ms|miss|sir)\.?\s+/i, '').split(' ')[0] : '';
    const suggestions = pageTeacher
        ? [`${pageTeacher.name} ki grading kesi hai?`, `How strict is ${firstName} about attendance?`, `Is ${firstName} good for beginners?`]
        : ['Calculus ke liye best teacher kaun hai?', 'Which teachers are lenient in grading?', 'How do I write a review?'];
    const hasUserMessage = messages.some((m) => m.role === 'user');
    const lastIsError = messages.length > 0 && messages[messages.length - 1].error;

    return (
        <>
            {!open && (
                <button
                    ref={launcherRef}
                    type="button"
                    className={`chat-launcher${raised ? ' chat-launcher-raised' : ''}`}
                    style={raised && raisedBottom !== null ? { bottom: raisedBottom } : undefined}
                    onClick={() => setOpen(true)}
                    aria-label="Ask the review assistant"
                    title="Ask about a teacher"
                >
                    <span className="chat-cat-perch"><ChatCat variant="perch" size={58} follow /></span>
                    {hint && <span className="chat-cat-hint" role="status">Meow! Kisi teacher ke baare mein poochna hai?</span>}
                    <SparkIcon />
                    <span className="chat-launcher-label">Ask AI</span>
                </button>
            )}
            {open && (
                <section className="chat-panel" role="dialog" aria-modal="false" aria-label="Review assistant">
                    <header className="chat-header">
                        <div className="chat-header-title">
                            <span className="chat-header-icon"><ChatCat size={30} mood={catMood} /></span>
                            <div>
                                <h2>Review assistant</h2>
                                <p>{pageTeacher ? `Asking about ${pageTeacher.name}` : 'Answers from student reviews'}</p>
                            </div>
                        </div>
                        <div className="chat-header-actions">
                            {hasUserMessage && (
                                <button type="button" className="chat-icon-btn chat-new-btn" onClick={reset} title="Start a new chat" aria-label="Start a new chat">
                                    New
                                </button>
                            )}
                            <button type="button" className="chat-icon-btn" onClick={close} aria-label="Close assistant">
                                <Icon name="x" size={18} />
                            </button>
                        </div>
                    </header>

                    <div className="chat-messages" ref={listRef} aria-live="polite">
                        {messages.map((m) => (
                            <div key={m.id} className={`chat-msg chat-msg-${m.role}${m.error ? ' chat-msg-error' : ''}`}>
                                <div className="chat-bubble">
                                    {m.role === 'assistant' ? renderRich(m.text) : m.text}
                                </div>
                                {m.role === 'assistant' && m.replyToken && m.question && (
                                    <div className="chat-feedback">
                                        <button
                                            type="button"
                                            className={`chat-feedback-btn${m.rating === 1 ? ' chat-feedback-btn-on' : ''}`}
                                            onClick={() => rate(m, 1)}
                                            disabled={m.feedback === 'sending' || m.rating === 1}
                                            aria-pressed={m.rating === 1}
                                            aria-label="Helpful answer"
                                            title="Helpful (shares this question and answer with the site admins)"
                                        >
                                            <ThumbIcon />
                                        </button>
                                        <button
                                            type="button"
                                            className={`chat-feedback-btn${m.rating === -1 ? ' chat-feedback-btn-on' : ''}`}
                                            onClick={() => rate(m, -1)}
                                            disabled={m.feedback === 'sending' || m.rating === -1}
                                            aria-pressed={m.rating === -1}
                                            aria-label="Not helpful answer"
                                            title="Not helpful (shares this question and answer with the site admins)"
                                        >
                                            <ThumbIcon down />
                                        </button>
                                        {m.feedback === 'saved' && <span className="chat-feedback-note">Thanks for the feedback!</span>}
                                        {m.feedback === 'failed' && <span className="chat-feedback-note chat-feedback-note-error">Could not save. Try again.</span>}
                                    </div>
                                )}
                                {m.role === 'assistant' && m.rating === -1 && m.feedback === 'saved' && !m.commentSent && (
                                    <form
                                        className="chat-feedback-comment"
                                        onSubmit={(e) => {
                                            e.preventDefault();
                                            const text = (commentDrafts[m.id] || '').trim();
                                            if (text) rate(m, -1, text);
                                        }}
                                    >
                                        <input
                                            type="text"
                                            maxLength={500}
                                            placeholder="What was wrong? (optional)"
                                            aria-label="What was wrong with this answer?"
                                            value={commentDrafts[m.id] || ''}
                                            onChange={(e) => setCommentDrafts((d) => ({ ...d, [m.id]: e.target.value }))}
                                        />
                                        <button type="submit" disabled={!(commentDrafts[m.id] || '').trim()}>Send</button>
                                    </form>
                                )}
                                {m.teachers && m.teachers.length > 0 && (
                                    <div className="chat-teacher-links">
                                        {m.teachers.map((t) => (
                                            <button key={t.id} type="button" className="chat-teacher-chip" onClick={() => openTeacher(t)} title={t.department}>
                                                {t.name} <span aria-hidden="true">→</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        {sending && (
                            <div className="chat-msg chat-msg-assistant">
                                <div className="chat-bubble chat-typing" aria-label="Assistant is typing">
                                    <span /><span /><span />
                                </div>
                            </div>
                        )}
                        {lastIsError && !sending && (
                            <button type="button" className="chat-retry-btn" onClick={retry}>Try again</button>
                        )}
                        {!hasUserMessage && !sending && (
                            <div className="chat-suggestions">
                                {suggestions.map((s) => (
                                    <button key={s} type="button" className="chat-suggestion" onClick={() => send(s)}>{s}</button>
                                ))}
                            </div>
                        )}
                    </div>

                    <form className="chat-input-row" onSubmit={onSubmit}>
                        <textarea
                            ref={inputRef}
                            className="chat-input"
                            rows={1}
                            value={input}
                            maxLength={MAX_LENGTH}
                            onChange={(e) => setInput(e.target.value)}
                            onKeyDown={onKeyDown}
                            placeholder={pageTeacher ? `Ask about ${firstName}…` : 'e.g. sir Waqar ki grading kesi hai?'}
                            aria-label="Your question"
                        />
                        <button type="submit" className="chat-send-btn" disabled={!input.trim() || sending} aria-label="Send">
                            <SendIcon />
                        </button>
                    </form>
                    <p className="chat-disclaimer">
                        AI summary of student reviews. It can be wrong. Rating an answer shares it with the site admins{input.length > MAX_LENGTH - 100 ? ` · ${MAX_LENGTH - input.length} characters left` : ''}.
                    </p>
                </section>
            )}
        </>
    );
};

export default ChatWidget;
