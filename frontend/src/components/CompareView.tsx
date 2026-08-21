import React from 'react';
import TeacherAutocomplete from './TeacherAutocomplete';
import SwipeableCards from './SwipeableCards';
import Avatar from './Avatar';
import EmptyState from './EmptyState';
import Icon from './Icon';
import { timeAgo } from '../utils/timeAgo';
import type { Teacher, TeacherDetail } from '../types';

interface CompareViewProps {
    compareDetails: TeacherDetail[];
    compareList: Teacher[];
    compareSearchTerm: string;
    setCompareSearchTerm: (v: string) => void;
    compareSearchInputRef: React.RefObject<HTMLInputElement>;
    handleCompareAdd: (teacher: Teacher) => void;
    setIsComparing: (v: boolean) => void;
    restoreListScroll: () => void;
    handleTeacherClick: (teacher: Teacher) => void;
    handleTeacherClickDetail: (teacher: TeacherDetail) => void;
    setCompareList: React.Dispatch<React.SetStateAction<Teacher[]>>;
    setCompareDetails: React.Dispatch<React.SetStateAction<TeacherDetail[]>>;
}

const CompareView: React.FC<CompareViewProps> = ({
    compareDetails,
    compareList,
    compareSearchTerm,
    setCompareSearchTerm,
    compareSearchInputRef,
    handleCompareAdd,
    setIsComparing,
    restoreListScroll,
    handleTeacherClick,
    handleTeacherClickDetail,
    setCompareList,
    setCompareDetails,
}) => {
    const handleRemove = (id: number) => {
        setCompareList(prev => prev.filter(x => x.id !== id));
        setCompareDetails(prev => prev.filter(x => x.id !== id));
    };

    return (
        <div className="compare-view page-enter">
            <div className="compare-view-header">
                <button onClick={() => { setIsComparing(false); restoreListScroll(); }} className="back-button">
                    ← Back to list
                </button>
                <h1 className="gradient-text compare-title"><Icon name="compare" size={26} /> Compare Teachers</h1>
            </div>

            <div className="compare-search">
                <TeacherAutocomplete
                    value={compareSearchTerm}
                    onInputChange={(e) => setCompareSearchTerm(e.target.value)}
                    inputRef={compareSearchInputRef}
                    onSelect={(teacher) => {
                        setCompareSearchTerm('');
                        handleCompareAdd(teacher);
                    }}
                    onClear={() => setCompareSearchTerm('')}
                    placeholder="Search and add a teacher to compare..."
                />
                <p className="compare-search-hint">{compareList.length}/3 selected — tap a result to add it to the comparison.</p>
            </div>

            {compareDetails.length < 2 ? (
                <div className="compare-selected-preview">
                    {compareList.length > 0 && (
                        <div className="compare-selected-teachers">
                            {compareList.map((teacher) => (
                                <div key={teacher.id} className="compare-selected-card">
                                    <div className="compare-selected-header">
                                        <div className="compare-selected-avatar">
                                            {teacher.image_url ? (
                                                <img src={teacher.image_url} alt={teacher.name} />
                                            ) : (
                                                <span className="compare-selected-initials">
                                                    {teacher.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                                                </span>
                                            )}
                                        </div>
                                        <div className="compare-selected-info">
                                            <span className="compare-selected-name">{teacher.name}</span>
                                            <span className="compare-selected-dept">{teacher.department}</span>
                                        </div>
                                        <button
                                            className="compare-selected-remove"
                                            onClick={() => handleRemove(teacher.id)}
                                            aria-label={`Remove ${teacher.name} from comparison`}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <EmptyState
                        icon="compare"
                        title={compareList.length === 0 ? "Start comparing teachers" : "Add one more teacher"}
                        message={
                            compareList.length === 0
                                ? "Search above to add at least 2 teachers, then their reviews appear side by side."
                                : "Search above to add 1 more teacher to start comparing."
                        }
                    />
                </div>
            ) : (
                <>
                    <div className="compare-table-wrap">
                        <table className="compare-table">
                            <thead>
                                <tr>
                                    <th className="compare-metric-cell">Attribute</th>
                                    {compareDetails.map((t) => (
                                        <th key={t.id} className="compare-teacher-cell">
                                            <div className="compare-table-teacher">
                                                <Avatar name={t.name} imageUrl={t.image_url} className="compare-table-avatar" />
                                                <div className="compare-table-teacher-info">
                                                    <span className="compare-table-name">{t.name}</span>
                                                    <span className="compare-table-dept">{t.department}</span>
                                                </div>
                                                <button
                                                    onClick={() => handleRemove(t.id)}
                                                    className="compare-table-remove"
                                                    aria-label={`Remove ${t.name} from comparison`}
                                                >
                                                    ✕
                                                </button>
                                            </div>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td className="compare-metric-cell">Reviews</td>
                                    {compareDetails.map((t) => (
                                        <td key={t.id} className="compare-value-cell">
                                            <span className="compare-count-badge">{t.review_count || 0}</span>
                                            <span className="compare-count-label">
                                                {t.review_count === 1 ? 'review' : 'reviews'}
                                            </span>
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="compare-metric-cell">Last review</td>
                                    {compareDetails.map((t) => (
                                        <td key={t.id} className="compare-value-cell">
                                            {t.reviews && t.reviews.length > 0
                                                ? timeAgo(t.reviews[0].created_at)
                                                : '—'}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="compare-metric-cell">Recent review</td>
                                    {compareDetails.map((t) => (
                                        <td key={t.id} className="compare-value-cell">
                                            {t.reviews && t.reviews.length > 0 ? (
                                                <blockquote className="compare-snippet">
                                                    "{t.reviews[0].comment.length > 90
                                                        ? `${t.reviews[0].comment.slice(0, 90)}…`
                                                        : t.reviews[0].comment}"
                                                    <footer className="compare-snippet-author">
                                                        — {t.reviews[0].user_name || 'Anonymous'}
                                                    </footer>
                                                </blockquote>
                                            ) : (
                                                <span className="compare-no-reviews">No reviews yet</span>
                                            )}
                                        </td>
                                    ))}
                                </tr>
                                <tr>
                                    <td className="compare-metric-cell">Profile</td>
                                    {compareDetails.map((t) => (
                                        <td key={t.id} className="compare-value-cell">
                                            <button
                                                onClick={() => {
                                                    setIsComparing(false);
                                                    handleTeacherClick({ ...t } as Teacher);
                                                }}
                                                className="compare-view-btn"
                                            >
                                                View full profile
                                            </button>
                                        </td>
                                    ))}
                                </tr>
                            </tbody>
                        </table>
                        <p className="compare-swipe-hint">← Swipe the table sideways to compare →</p>
                    </div>

                    <SwipeableCards
                        teachers={compareDetails}
                        onRemove={handleRemove}
                        onTeacherClick={(t) => {
                            setIsComparing(false);
                            handleTeacherClickDetail(t);
                        }}
                    />
                </>
            )}
        </div>
    );
};

export default CompareView;
