import React, { useCallback, useEffect, useState } from 'react';
import Icon from './Icon';
import { getAdminErrors, setAdminErrorResolved, deleteAdminError, resolveAllAdminErrors } from '../services/api';
import type { AdminErrorLog } from '../types';

interface AdminErrorsTabProps {
    showToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    /** Refresh the header counters after a change. */
    onChanged?: () => void | Promise<void>;
}

type Status = 'open' | 'resolved';

const timeAgo = (iso: string): string => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.round(diff / 60000);
    if (m < 1) return 'abhi';
    if (m < 60) return `${m} min pehle`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h} ghante pehle`;
    return `${Math.round(h / 24)} din pehle`;
};

const AdminErrorsTab: React.FC<AdminErrorsTabProps> = ({ showToast, onChanged }) => {
    const [status, setStatus] = useState<Status>('open');
    const [errors, setErrors] = useState<AdminErrorLog[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async (s: Status, p: number, append = false) => {
        setLoading(true);
        try {
            const res = await getAdminErrors(s, p);
            const list = (res.data?.errors || []) as AdminErrorLog[];
            setErrors((prev) => (append ? [...prev, ...list] : list));
            setTotal(res.data?.pagination?.total || 0);
            setTotalPages(res.data?.pagination?.totalPages || 1);
            setPage(p);
        } catch {
            showToast('Errors load nahi ho sakay', 'error');
        } finally {
            setLoading(false);
        }
    }, [showToast]);

    useEffect(() => { load(status, 1); }, [status, load]);

    const act = async (fn: () => Promise<unknown>, okMessage: string) => {
        setBusy(true);
        try {
            await fn();
            showToast(okMessage, 'success');
            await load(status, 1);
            await onChanged?.();
        } catch {
            showToast('Kaam nahi hua, dobara koshish karein', 'error');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="admin-section">
            <h3>Errors{status === 'open' && total > 0 ? ` (${total})` : ''}</h3>
            <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 12px' }}>
                Website aur server par jo errors aate hain woh yahan jama hote hain (ek jaisa error ek hi line mein, ginti ke saath).
                Naya error aaye to admin email par alert jata hai, ghante mein zyada se zyada ek email.
                Resolve kiya hua error dobara aaye to wapas yahan khul jata hai.
            </p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
                {(['open', 'resolved'] as const).map((s) => (
                    <button
                        key={s}
                        type="button"
                        className={`admin-mini-btn${status === s ? ' admin-mini-approve' : ''}`}
                        aria-pressed={status === s}
                        onClick={() => setStatus(s)}
                        disabled={loading || busy}
                    >
                        {s === 'open' ? 'Open' : 'Resolved'}
                    </button>
                ))}
                {status === 'open' && errors.length > 0 && (
                    <button
                        type="button"
                        className="admin-mini-btn"
                        style={{ marginLeft: 'auto' }}
                        disabled={busy}
                        onClick={() => {
                            if (window.confirm(`Saare ${total} open errors resolve kar dein?`)) {
                                act(() => resolveAllAdminErrors(), 'Saare errors resolve ho gaye');
                            }
                        }}
                    >
                        <Icon name="check" size={13} /> Resolve all
                    </button>
                )}
            </div>

            <div className="admin-list">
                {loading && errors.length === 0 ? (
                    <div className="spinner" style={{ margin: '20px auto' }} />
                ) : errors.length === 0 ? (
                    <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                        {status === 'open' ? 'Koi open error nahi. 🎉' : 'Koi resolved error nahi.'}
                    </p>
                ) : (
                    errors.map((e) => (
                        <div key={e.id} className="admin-item admin-error-item" style={{ alignItems: 'flex-start' }}>
                            <div className="review-info" style={{ minWidth: 0 }}>
                                <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span
                                        className="admin-pending-badge"
                                        style={e.source === 'frontend' ? { background: '#e0e7ff', color: '#3730a3', borderColor: '#c7d2fe' } : undefined}
                                    >
                                        {e.source === 'frontend' ? 'Browser' : 'Server'}
                                    </span>
                                    <strong style={{ fontSize: '0.9rem' }}>× {e.occurrences}</strong>
                                    <small style={{ color: '#64748b' }}>
                                        Aakhri dafa {timeAgo(e.last_seen)} · pehli dafa {new Date(e.first_seen).toLocaleString()}
                                    </small>
                                </div>
                                <p style={{ margin: '6px 0 4px', wordBreak: 'break-word', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: '0.82rem' }}>
                                    {e.message}
                                </p>
                                {(e.method || e.path) && (
                                    <small style={{ color: '#64748b', wordBreak: 'break-all' }}>
                                        {e.method ? `${e.method} ` : ''}{e.path}
                                    </small>
                                )}
                                {e.stack && (
                                    <details style={{ marginTop: '6px' }}>
                                        <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: '#64748b' }}>Stack trace</summary>
                                        <pre style={{ margin: '6px 0 0', padding: '8px', maxHeight: '240px', overflow: 'auto', background: '#f8f5ee', borderRadius: '8px', fontSize: '0.72rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                            {e.stack}
                                        </pre>
                                        {e.user_agent && <small style={{ color: '#94a3b8', wordBreak: 'break-all' }}>{e.user_agent}</small>}
                                    </details>
                                )}
                            </div>
                            <div className="admin-item-actions">
                                {Number(e.resolved) ? (
                                    <button className="admin-mini-btn" disabled={busy} onClick={() => act(() => setAdminErrorResolved(e.id, false), 'Error reopen ho gaya')}>
                                        Reopen
                                    </button>
                                ) : (
                                    <button className="admin-mini-btn admin-mini-approve" disabled={busy} onClick={() => act(() => setAdminErrorResolved(e.id, true), 'Error resolve ho gaya')}>
                                        Resolve
                                    </button>
                                )}
                                <button
                                    className="admin-mini-btn admin-mini-reject"
                                    disabled={busy}
                                    onClick={() => { if (window.confirm('Yeh error delete kar dein?')) act(() => deleteAdminError(e.id), 'Error delete ho gaya'); }}
                                >
                                    Delete
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
            {page < totalPages && (
                <button className="add-teacher-btn" style={{ marginTop: '12px' }} disabled={loading} onClick={() => load(status, page + 1, true)}>
                    {loading ? 'Loading…' : 'Load more'}
                </button>
            )}
        </div>
    );
};

export default AdminErrorsTab;
