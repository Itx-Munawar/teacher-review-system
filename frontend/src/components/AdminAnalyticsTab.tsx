import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { getAdminAnalytics } from '../services/api';
import type { AdminAnalytics } from '../types';

type Days = 7 | 30 | 90;
type Metric = 'visits' | 'teacher_views' | 'reviews';

const METRIC_LABEL: Record<Metric, string> = {
    visits: 'Visits',
    teacher_views: 'Profile views',
    reviews: 'Reviews submitted',
};

const fmt = (n: number) => n.toLocaleString('en-US');

const cardStyle: React.CSSProperties = {
    flex: '1 1 140px',
    padding: '12px 14px',
    borderRadius: '14px',
    border: '1px solid rgba(94, 58, 114, 0.18)',
    background: 'rgba(255, 253, 248, 0.9)',
};

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' };
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid #e6dcc9', color: '#64748b', fontWeight: 600, whiteSpace: 'nowrap' };
const tdStyle: React.CSSProperties = { padding: '6px 8px', borderBottom: '1px solid #f1ebdf', verticalAlign: 'top' };
const numStyle: React.CSSProperties = { ...tdStyle, textAlign: 'right', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };

/** Small dependency-free SVG bar chart. */
const BarChart: React.FC<{ data: { day: string; value: number }[]; label: string }> = ({ data, label }) => {
    const max = Math.max(1, ...data.map((d) => d.value));
    const w = 640;
    const h = 160;
    const pad = { top: 10, bottom: 22, left: 34, right: 6 };
    const innerW = w - pad.left - pad.right;
    const innerH = h - pad.top - pad.bottom;
    const slot = innerW / Math.max(1, data.length);
    const barW = Math.max(2, slot * 0.7);
    const ticks = [0, Math.round(max / 2), max];
    const labelEvery = Math.ceil(data.length / 8);
    return (
        <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={`${label} per day`} style={{ display: 'block', maxHeight: '200px' }}>
            {ticks.map((t) => {
                const y = pad.top + innerH - (t / max) * innerH;
                return (
                    <g key={t}>
                        <line x1={pad.left} x2={w - pad.right} y1={y} y2={y} stroke="#eee5d6" strokeWidth="1" />
                        <text x={pad.left - 6} y={y + 4} fontSize="10" textAnchor="end" fill="#94a3b8">{t}</text>
                    </g>
                );
            })}
            {data.map((d, i) => {
                const bh = (d.value / max) * innerH;
                const x = pad.left + i * slot + (slot - barW) / 2;
                return (
                    <g key={d.day}>
                        <rect x={x} y={pad.top + innerH - bh} width={barW} height={Math.max(bh, d.value > 0 ? 1 : 0)} rx="2" fill="#825c24">
                            <title>{`${d.day}: ${d.value}`}</title>
                        </rect>
                        {i % labelEvery === 0 && (
                            <text x={x + barW / 2} y={h - 6} fontSize="10" textAnchor="middle" fill="#94a3b8">
                                {d.day.slice(5)}
                            </text>
                        )}
                    </g>
                );
            })}
        </svg>
    );
};

const AdminAnalyticsTab: React.FC = () => {
    const [days, setDays] = useState<Days>(30);
    const [metric, setMetric] = useState<Metric>('visits');
    const [data, setData] = useState<AdminAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const load = useCallback(async (d: Days) => {
        setLoading(true);
        setError('');
        try {
            const res = await getAdminAnalytics(d);
            setData(res.data as AdminAnalytics);
        } catch {
            setError('Analytics load nahi ho sakay. Dobara koshish karein.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(days); }, [days, load]);

    // Departments with the lowest share of reviewed teachers first.
    const departments = useMemo(() => [...(data?.departments || [])]
        .filter((d) => d.teachers >= 3)
        .sort((a, b) => (a.reviewed_teachers / a.teachers) - (b.reviewed_teachers / b.teachers) || b.teachers - a.teachers),
    [data]);

    const totals = data?.totals;
    const chart = (data?.daily || []).map((d) => ({ day: d.day, value: d[metric] }));

    return (
        <div className="admin-section">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginBottom: '6px' }}>
                <h3 style={{ margin: 0 }}>Analytics</h3>
                <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }} role="group" aria-label="Time range">
                    {([7, 30, 90] as Days[]).map((d) => (
                        <button
                            key={d}
                            type="button"
                            className={`admin-mini-btn${days === d ? ' admin-mini-approve' : ''}`}
                            aria-pressed={days === d}
                            onClick={() => setDays(d)}
                            disabled={loading}
                        >
                            {d} din
                        </button>
                    ))}
                </div>
            </div>
            <p style={{ color: '#64748b', fontSize: '0.82rem', margin: '0 0 14px' }}>
                Sirf gintiyan save hoti hain (koi IP ya student ki pehchan nahi). Bots gine nahi jaate. Din Pakistan time ke hisaab se.
            </p>

            {error && <p className="error-message">{error}</p>}
            {loading && !data && <div className="spinner" style={{ margin: '30px auto' }} />}
            {data && !data.available && (
                <p style={{ color: '#64748b' }}>Analytics tables abhi tayyar nahi hain (server restart ke baad aa jayengi).</p>
            )}

            {data?.available && totals && (
                <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s' }}>
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginBottom: '16px' }}>
                        {([
                            ['Visits', totals.visits],
                            ['Profile views', totals.teacher_views],
                            ['Reviews submitted', totals.reviews_submitted],
                            ['Replies', totals.replies_submitted],
                            ['Helpful votes', totals.helpful_votes],
                            ['Questions', totals.questions_asked],
                        ] as [string, number][]).map(([label, value]) => (
                            <div key={label} style={cardStyle}>
                                <div style={{ fontSize: '1.35rem', fontWeight: 700, color: '#2a1838' }}>{fmt(value)}</div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{label}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ ...cardStyle, marginBottom: '18px' }}>
                        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }} role="group" aria-label="Chart metric">
                            {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
                                <button
                                    key={m}
                                    type="button"
                                    className={`admin-mini-btn${metric === m ? ' admin-mini-approve' : ''}`}
                                    aria-pressed={metric === m}
                                    onClick={() => setMetric(m)}
                                >
                                    {METRIC_LABEL[m]}
                                </button>
                            ))}
                        </div>
                        <BarChart data={chart} label={METRIC_LABEL[metric]} />
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '18px' }}>
                        <section>
                            <h4 style={{ margin: '0 0 6px' }}>Sab se zyada dekhe gaye teachers</h4>
                            {(data.top_teachers || []).length === 0 ? (
                                <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Abhi koi data nahi.</p>
                            ) : (
                                <table style={tableStyle}>
                                    <thead><tr><th style={thStyle}>Teacher</th><th style={{ ...thStyle, textAlign: 'right' }}>Views</th><th style={{ ...thStyle, textAlign: 'right' }}>Reviews</th></tr></thead>
                                    <tbody>
                                        {(data.top_teachers || []).map((t) => (
                                            <tr key={t.id}>
                                                <td style={tdStyle}>{t.name}<br /><small style={{ color: '#94a3b8' }}>{t.department}</small></td>
                                                <td style={numStyle}>{fmt(t.views)}</td>
                                                <td style={numStyle}>{fmt(t.reviews)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>

                        <section>
                            <h4 style={{ margin: '0 0 2px' }}>
                                <Icon name="alert-triangle" size={14} /> Reviews ki zaroorat
                            </h4>
                            <p style={{ color: '#64748b', fontSize: '0.78rem', margin: '0 0 6px' }}>
                                Log dekh rahe hain magar 3 se kam reviews hain. Inke liye review mangna faida dega.
                            </p>
                            {(data.needs_reviews || []).length === 0 ? (
                                <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Koi nahi.</p>
                            ) : (
                                <table style={tableStyle}>
                                    <thead><tr><th style={thStyle}>Teacher</th><th style={{ ...thStyle, textAlign: 'right' }}>Views</th><th style={{ ...thStyle, textAlign: 'right' }}>Reviews</th></tr></thead>
                                    <tbody>
                                        {(data.needs_reviews || []).map((t) => (
                                            <tr key={t.id}>
                                                <td style={tdStyle}>{t.name}<br /><small style={{ color: '#94a3b8' }}>{t.department}</small></td>
                                                <td style={numStyle}>{fmt(t.views)}</td>
                                                <td style={{ ...numStyle, color: t.reviews === 0 ? '#b45309' : undefined, fontWeight: t.reviews === 0 ? 700 : undefined }}>{t.reviews}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>

                        <section>
                            <h4 style={{ margin: '0 0 6px' }}>Top searches</h4>
                            {(data.top_searches || []).length === 0 ? (
                                <p style={{ color: '#94a3b8', fontSize: '0.85rem' }}>Abhi koi data nahi.</p>
                            ) : (
                                <table style={tableStyle}>
                                    <thead><tr><th style={thStyle}>Search</th><th style={{ ...thStyle, textAlign: 'right' }}>Kitni dafa</th></tr></thead>
                                    <tbody>
                                        {(data.top_searches || []).map((s) => (
                                            <tr key={s.term}>
                                                <td style={tdStyle}>
                                                    {s.term}
                                                    {s.min_results === 0 && (
                                                        <span className="admin-pending-badge" style={{ marginLeft: '6px' }} title="Kam az kam ek dafa koi result nahi mila">0 results</span>
                                                    )}
                                                </td>
                                                <td style={numStyle}>{fmt(s.searches)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </section>

                        <section>
                            <h4 style={{ margin: '0 0 2px' }}>Departments (kam reviews wale pehle)</h4>
                            <p style={{ color: '#64748b', fontSize: '0.78rem', margin: '0 0 6px' }}>
                                &quot;Reviewed&quot; = kitne teachers ka kam az kam ek approved review hai. 3 se kam teachers wale departments chhupaye gaye hain.
                            </p>
                            <table style={tableStyle}>
                                <thead>
                                    <tr>
                                        <th style={thStyle}>Department</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Reviewed</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Reviews</th>
                                        <th style={{ ...thStyle, textAlign: 'right' }}>Views</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {departments.map((d) => {
                                        const pct = Math.round((d.reviewed_teachers / d.teachers) * 100);
                                        return (
                                            <tr key={d.department || '(none)'}>
                                                <td style={tdStyle}>{d.department || '(none)'}</td>
                                                <td style={{ ...numStyle, color: pct < 30 ? '#b45309' : undefined, fontWeight: pct < 30 ? 700 : undefined }}>
                                                    {d.reviewed_teachers}/{d.teachers} ({pct}%)
                                                </td>
                                                <td style={numStyle}>{fmt(d.reviews)}</td>
                                                <td style={numStyle}>{fmt(d.views)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </section>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminAnalyticsTab;
