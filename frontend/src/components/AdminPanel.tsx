import React, { useState, useEffect, useMemo, memo } from 'react';
import Icon from './Icon';
import { getTeachers } from '../services/api';
import { extractCourses } from '../utils/courses';
import Avatar from './Avatar';
import type { Teacher, AdminReview, AdminQuestion, CustomCourse, AdminTeacherDetail, AdminReport } from '../types';

type AdminTab = 'teachers' | 'reviews' | 'qa' | 'courses' | 'reports';

type TeacherSortKey = 'name' | 'department' | 'reviews' | 'newest';

export interface AdminPanelProps {
    teachers: Teacher[];
    reviewsForModeration: AdminReview[];
    totalReviewsCount: number;
    /** Reviews waiting for approval (global count from /api/admin/stats). */
    pendingReviewsCount: number;
    /** When true, the reviews list shows only pending (unapproved) reviews. */
    reviewsPendingOnly: boolean;
    /** Flip the pending-only filter (dashboard pending counter / show-all). */
    onTogglePendingOnly: () => void | Promise<void>;
    onAddTeacher: (e: React.FormEvent) => void;
    onDeleteTeacher: (id: number) => void;
    onUpdateTeacher: (id: number, data: { name: string; department: string; image_url?: string }) => void;
    onDeleteReview: (id: number) => void | Promise<void>;
    onUpdateReview: (id: number, data: { comment: string; user_name?: string; is_approved?: boolean }) => void | Promise<void>;
    onApproveReview: (id: number) => void | Promise<void>;
    onRejectReview: (id: number) => void | Promise<void>;
    onLogout: () => void;
    showAddTeacherForm: boolean;
    setShowAddTeacherForm: (v: boolean) => void;
    newTeacherName: string;
    setNewTeacherName: (v: string) => void;
    newTeacherDepartment: string;
    setNewTeacherDepartment: (v: string) => void;
    /** Existing department names, offered as suggestions when adding/editing a teacher */
    departmentOptions: string[];
    newTeacherImage: string;
    setNewTeacherImage: (v: string) => void;
    totalTeachersCount: number;
    loadingMore: boolean;
    onLoadMore: () => void;
    searchTerm: string;
    onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    searchResults: Teacher[];
    isSearching: boolean;
    onLoadMoreReviews: () => void;
    adminLoadingMoreReviews: boolean;
    adminReviewsTotalPages: number;
    adminReviewsPage: number;
    adminQuestions: AdminQuestion[];
    onDeleteQuestion: (id: number) => void;
    onUpdateQuestion: (id: number, data: { question?: string; is_approved?: boolean }) => void | Promise<void>;
    onUpdateAnswer: (id: number, data: { answer?: string; is_approved?: boolean }) => void | Promise<void>;
    onBulkReviewDecision: (ids: number[], action: 'approve' | 'reject') => void | Promise<void>;
    adminMutationLoading: boolean;
    adminLoadingMoreQuestions: boolean;
    adminQuestionsPage: number;
    adminQuestionsTotalPages: number;
    onLoadMoreQuestions: () => void;
    customCourses: CustomCourse[];
    onReviewCourse: (id: number, action: 'approve' | 'reject') => void;
    onLoadTeacherDetail: (id: number) => Promise<AdminTeacherDetail | null>;
    onCleanTeacherImages: (dryRun: boolean) => Promise<{ cleaned?: number; wouldClean?: number; broken?: number; blank?: number }>;
    /** Reader reports for the Reports tab (already filtered by status). */
    reports: AdminReport[];
    /** Open reports badge shown in the header. */
    openReportsCount: number;
    reportsStatus: 'open' | 'resolved' | 'dismissed';
    onReportsStatusChange: (status: 'open' | 'resolved' | 'dismissed') => void | Promise<void>;
    onUpdateReportStatus: (id: number, status: 'open' | 'resolved' | 'dismissed') => void | Promise<void>;
    onLoadMoreReports: () => void;
    adminReportsPage: number;
    adminReportsTotalPages: number;
    adminLoadingMoreReports: boolean;
}

const AdminPanel = memo(({
    teachers,
    reviewsForModeration,
    totalReviewsCount,
    pendingReviewsCount,
    reviewsPendingOnly,
    onTogglePendingOnly,
    onAddTeacher,
    onDeleteTeacher,
    onUpdateTeacher,
    onDeleteReview,
    onUpdateReview,
    onApproveReview,
    onRejectReview,
    onLogout,
    showAddTeacherForm,
    setShowAddTeacherForm,
    newTeacherName,
    setNewTeacherName,
    newTeacherDepartment,
    setNewTeacherDepartment,
    departmentOptions,
    newTeacherImage,
    setNewTeacherImage,
    totalTeachersCount,
    loadingMore,
    onLoadMore,
    searchTerm,
    onSearchChange,
    searchResults,
    isSearching,
    onLoadMoreReviews,
    adminLoadingMoreReviews,
    adminReviewsTotalPages,
    adminReviewsPage,
    adminQuestions,
    onDeleteQuestion,
    onUpdateQuestion,
    onUpdateAnswer,
    onBulkReviewDecision,
    adminMutationLoading,
    adminLoadingMoreQuestions,
    adminQuestionsPage,
    adminQuestionsTotalPages,
    onLoadMoreQuestions,
    customCourses,
    onReviewCourse,
    onLoadTeacherDetail,
    onCleanTeacherImages,
    reports,
    openReportsCount,
    reportsStatus,
    onReportsStatusChange,
    onUpdateReportStatus,
    onLoadMoreReports,
    adminReportsPage,
    adminReportsTotalPages,
    adminLoadingMoreReports
}: AdminPanelProps) => {
    // Broken-photo cleanup: preview first, then confirm
    const [photoCheck, setPhotoCheck] = useState<{ count: number; broken: number } | null>(null);
    const [photoBusy, setPhotoBusy] = useState(false);
    const [photoCleaned, setPhotoCleaned] = useState<number | null>(null);

    const handleCheckPhotos = async () => {
        setPhotoBusy(true);
        try {
            const res = await onCleanTeacherImages(true);
            setPhotoCheck({ count: res.wouldClean || 0, broken: res.broken || 0 });
            setPhotoCleaned(null);
        } finally {
            setPhotoBusy(false);
        }
    };

    const handleCleanPhotos = async () => {
        setPhotoBusy(true);
        try {
            const res = await onCleanTeacherImages(false);
            setPhotoCleaned(res.cleaned || 0);
            setPhotoCheck(null);
        } finally {
            setPhotoBusy(false);
        }
    };

    const totalReviews = totalReviewsCount || reviewsForModeration?.length || 0;
    const pendingCoursesCount = customCourses.filter(c => c.status === 'pending').length;
    const visibleCourses = customCourses.filter(c => c.status !== 'rejected');

    // Full server-sorted list: fetched like the home page so sorting covers
    // EVERY teacher (server ORDER BY), not just the shared loaded pages.
    const [allTeachers, setAllTeachers] = useState<Teacher[]>([]);
    const [sortLoading, setSortLoading] = useState(false);

    const baseTeachers = allTeachers.length > 0 ? allTeachers : teachers;
    const displayTeachers = searchTerm ? searchResults : baseTeachers;

    // Teacher list sorting (Manage Teachers tab)
    const [teacherSortKey, setTeacherSortKey] = useState<TeacherSortKey>('name');
    const [teacherSortDir, setTeacherSortDir] = useState<'asc' | 'desc'>('asc');

    const sortedTeachers = useMemo(() => {
        const dir = teacherSortDir === 'asc' ? 1 : -1;
        const byName = (a: Teacher, b: Teacher) => a.name.localeCompare(b.name) || a.id - b.id;
        return [...displayTeachers].sort((a, b) => {
            switch (teacherSortKey) {
                case 'department':
                    return (a.department.localeCompare(b.department) || byName(a, b)) * dir;
                case 'reviews':
                    return ((a.review_count || 0) - (b.review_count || 0) || byName(a, b)) * dir;
                case 'newest':
                    return ((a.created_at || '').localeCompare(b.created_at || '') || byName(a, b)) * dir;
                case 'name':
                default:
                    return byName(a, b) * dir;
            }
        });
    }, [displayTeachers, teacherSortKey, teacherSortDir]);

    // Load every teacher, server-side ordered (mirrors the home page loader).
    // Runs on mount and whenever the sort field changes; direction flips are
    // pure client-side re-ordering of the already-complete list.
    useEffect(() => {
        let cancelled = false;
        const serverSort = teacherSortKey === 'reviews' || teacherSortKey === 'newest' ? teacherSortKey : 'name';
        setSortLoading(true);
        (async () => {
            try {
                const first = await getTeachers(1, serverSort, undefined, 200);
                if (cancelled) return;
                let list: Teacher[] = first.data?.teachers || [];
                const totalPages: number = first.data?.pagination?.totalPages || 1;
                if (totalPages > 1) {
                    const rest = await Promise.all(
                        Array.from({ length: totalPages - 1 }, (_, i) => getTeachers(i + 2, serverSort, undefined, 200))
                    );
                    if (cancelled) return;
                    rest.forEach((r) => { list = list.concat(r.data?.teachers || []); });
                }
                setAllTeachers(list);
            } catch (err) {
                // Keep the shared paginated list already on screen as fallback.
                if (!cancelled) console.error('Failed to load full teacher list:', err);
            } finally {
                if (!cancelled) setSortLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [teacherSortKey]);

    const sortDirLabel = teacherSortKey === 'reviews'
        ? (teacherSortDir === 'asc' ? '↑ Fewest' : '↓ Most')
        : teacherSortKey === 'newest'
            ? (teacherSortDir === 'asc' ? '↑ Oldest' : '↓ Newest')
            : (teacherSortDir === 'asc' ? '↑ A→Z' : '↓ Z→A');

    // Tab state
    const [activeTab, setActiveTab] = useState<AdminTab>('teachers');

    // Edit state (teachers)
    const [editingTeacherId, setEditingTeacherId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editDepartment, setEditDepartment] = useState('');
    const [editImageUrl, setEditImageUrl] = useState('');

    // Edit state (reviews)
    const [editingReviewId, setEditingReviewId] = useState<number | null>(null);
    const [editReviewComment, setEditReviewComment] = useState('');
    const [editReviewUserName, setEditReviewUserName] = useState('');

    // Bulk moderation selection (reviews tab)
    const [selectedReviewIds, setSelectedReviewIds] = useState<number[]>([]);

    // Teacher detail view state
    const [detailTeacherId, setDetailTeacherId] = useState<number | null>(null);
    const [teacherDetail, setTeacherDetail] = useState<AdminTeacherDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    // Edit handlers
    const startEdit = (teacher: Teacher) => {
        setEditingTeacherId(teacher.id);
        setEditName(teacher.name);
        setEditDepartment(teacher.department);
        setEditImageUrl(teacher.image_url || '');
    };

    const cancelEdit = () => {
        setEditingTeacherId(null);
        setEditName('');
        setEditDepartment('');
        setEditImageUrl('');
    };

    const handleUpdate = async (id: number) => {
        await onUpdateTeacher(id, {
            name: editName,
            department: editDepartment,
            image_url: editImageUrl || undefined
        });
        cancelEdit();
    };

    // Review edit handlers
    const startEditReview = (review: { id: number; comment: string; user_name?: string }) => {
        setEditingReviewId(review.id);
        setEditReviewComment(review.comment);
        setEditReviewUserName(review.user_name || '');
    };

    const cancelEditReview = () => {
        setEditingReviewId(null);
        setEditReviewComment('');
        setEditReviewUserName('');
    };

    // Re-fetch the open teacher detail so edits/deletes/approvals show
    // immediately in the teacher-section detail panel.
    const refreshTeacherDetail = async () => {
        if (detailTeacherId) {
            const detail = await onLoadTeacherDetail(detailTeacherId);
            setTeacherDetail(detail);
        }
    };

    // Refetching the list after a mutation can change the page height and
    // yank the viewport; capture the scroll offset and restore it right after
    // the re-render so the admin stays on the row they just acted on.
    const preserveScrollPos = async (run: () => Promise<unknown>) => {
        const y = window.scrollY;
        await run();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => window.scrollTo({ top: y, behavior: 'auto' }));
        });
    };

    const handleUpdateReview = (id: number, approve?: boolean) =>
        preserveScrollPos(async () => {
            await onUpdateReview(id, {
                comment: editReviewComment,
                user_name: editReviewUserName || undefined,
                ...(approve ? { is_approved: true } : {})
            });
            cancelEditReview();
            await refreshTeacherDetail();
        });

    const handleDeleteReview = (id: number) =>
        preserveScrollPos(async () => {
            await onDeleteReview(id);
            await refreshTeacherDetail();
        });

    const handleApproveReview = (id: number) =>
        preserveScrollPos(async () => {
            await onApproveReview(id);
            await refreshTeacherDetail();
        });

    const handleRejectReview = (id: number) =>
        preserveScrollPos(async () => {
            await onRejectReview(id);
            await refreshTeacherDetail();
        });

    // Bulk moderation: only ids still present and still pending count.
    const selectedPendingIds = selectedReviewIds.filter((id) =>
        reviewsForModeration.some((r) => r.id === id && Number(r.is_approved) === 0)
    );

    const toggleReviewSelection = (id: number) => {
        setSelectedReviewIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    };

    const clearReviewSelection = () => setSelectedReviewIds([]);

    const runBulkDecision = (action: 'approve' | 'reject') => {
        if (selectedPendingIds.length === 0) return;
        return preserveScrollPos(async () => {
            await onBulkReviewDecision(selectedPendingIds, action);
            clearReviewSelection();
        });
    };

    // Shared inline edit form, used by the reviews tab and the teacher
    // detail panel so both offer edit + save-and-approve.
    const renderReviewEditForm = (reviewId: number, isPending: boolean) => (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
            <textarea
                value={editReviewComment}
                onChange={(e) => setEditReviewComment(e.target.value)}
                placeholder="Review comment"
                aria-label="Edit review comment"
                className="search-input"
                style={{ margin: 0, minHeight: '60px', resize: 'vertical' }}
            />
            <input
                type="text"
                value={editReviewUserName}
                onChange={(e) => setEditReviewUserName(e.target.value)}
                placeholder="Reviewer name"
                aria-label="Edit reviewer name"
                className="search-input"
                style={{ margin: 0 }}
            />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => handleUpdateReview(reviewId)} className="btn-submit" style={{ padding: '4px 12px' }} disabled={adminMutationLoading}>Save</button>
                {isPending && (
                    <button
                        onClick={() => handleUpdateReview(reviewId, true)}
                        className="btn-submit"
                        style={{ padding: '4px 12px', background: '#10b981', borderColor: '#10b981' }}
                        disabled={adminMutationLoading}
                    >
                        Save &amp; Approve
                    </button>
                )}
                <button onClick={cancelEditReview} className="btn-cancel" style={{ padding: '4px 12px' }}>Cancel</button>
            </div>
        </div>
    );

    const toggleTeacherDetail = async (id: number) => {
        if (detailTeacherId === id) {
            setDetailTeacherId(null);
            setTeacherDetail(null);
            return;
        }
        setDetailTeacherId(id);
        setDetailLoading(true);
        setTeacherDetail(null);
        const detail = await onLoadTeacherDetail(id);
        setTeacherDetail(detail);
        setDetailLoading(false);
    };

    return (
        <div className="admin-panel">
            <div className="admin-header">
                <h2 className="gradient-text">Admin Dashboard</h2>
                <div className="admin-stats">
                    <span><Icon name="book" size={15} /> {totalTeachersCount || teachers.length} Teachers</span>
                    <span><Icon name="message-circle" size={15} /> {totalReviews} Reviews</span>
                    <button
                        type="button"
                        onClick={() => { setActiveTab('reviews'); onTogglePendingOnly(); }}
                        aria-pressed={reviewsPendingOnly}
                        title="Show only pending reviews"
                        style={{
                            background: reviewsPendingOnly
                                ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.35), rgba(245, 158, 11, 0.18))'
                                : 'linear-gradient(135deg, rgba(125, 74, 95, 0.15), rgba(63, 99, 96, 0.15))',
                            border: `1px solid ${reviewsPendingOnly ? 'rgba(245, 158, 11, 0.65)' : 'rgba(94, 58, 114, 0.25)'}`,
                            padding: '6px 14px',
                            borderRadius: '50px',
                            fontWeight: pendingReviewsCount > 0 ? 700 : 600,
                            fontSize: '0.85rem',
                            color: pendingReviewsCount > 0 ? '#b45309' : '#2a1838',
                            fontFamily: 'inherit',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}
                    >
                        {pendingReviewsCount} Pending{reviewsPendingOnly ? ' ✓' : ''}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('reports')}
                        title="Open reader reports"
                        style={{
                            background: openReportsCount > 0
                                ? 'linear-gradient(135deg, rgba(239, 68, 68, 0.22), rgba(239, 68, 68, 0.1))'
                                : 'linear-gradient(135deg, rgba(125, 74, 95, 0.15), rgba(63, 99, 96, 0.15))',
                            border: `1px solid ${openReportsCount > 0 ? 'rgba(239, 68, 68, 0.55)' : 'rgba(94, 58, 114, 0.25)'}`,
                            padding: '6px 14px',
                            borderRadius: '50px',
                            fontWeight: openReportsCount > 0 ? 700 : 600,
                            fontSize: '0.85rem',
                            color: openReportsCount > 0 ? '#b91c1c' : '#2a1838',
                            fontFamily: 'inherit',
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px'
                        }}
                    >
                        <Icon name="flag" size={14} /> {openReportsCount} Report{openReportsCount === 1 ? '' : 's'}
                    </button>
                </div>
                <button onClick={onLogout} className="logout-btn">Logout</button>
            </div>

            <div className="admin-tabs">
                <button
                    className={`admin-tab ${activeTab === 'teachers' ? 'admin-tab-active' : ''}`}
                    onClick={() => setActiveTab('teachers')}
                >
                    <Icon name="book" size={15} /> Teachers
                </button>
                <button
                    className={`admin-tab ${activeTab === 'reviews' ? 'admin-tab-active' : ''}`}
                    onClick={() => {
                        setActiveTab('reviews');
                        // The tab always opens the full list; pending-only is
                        // only reachable via the dashboard counter.
                        if (reviewsPendingOnly) onTogglePendingOnly();
                    }}
                >
                    <Icon name="message-circle" size={15} /> Reviews{totalReviews > 0 ? ` (${totalReviews})` : ''}
                </button>
                <button
                    className={`admin-tab ${activeTab === 'qa' ? 'admin-tab-active' : ''}`}
                    onClick={() => setActiveTab('qa')}
                >
                    <Icon name="message-square" size={15} /> Q&A
                </button>
                <button
                    className={`admin-tab ${activeTab === 'courses' ? 'admin-tab-active' : ''}`}
                    onClick={() => setActiveTab('courses')}
                >
                    <Icon name="book-open" size={15} /> Courses{pendingCoursesCount > 0 ? ` (${pendingCoursesCount})` : ''}
                </button>
                <button
                    className={`admin-tab ${activeTab === 'reports' ? 'admin-tab-active' : ''}`}
                    onClick={() => setActiveTab('reports')}
                >
                    <Icon name="flag" size={15} /> Reports{openReportsCount > 0 ? ` (${openReportsCount})` : ''}
                </button>
            </div>

            {activeTab === 'teachers' && (
            <>
            <div className="admin-section">
                <button onClick={() => setShowAddTeacherForm(!showAddTeacherForm)} className="add-teacher-btn">
                    {showAddTeacherForm ? (
                        'Cancel'
                    ) : (
                        <>
                            <Icon name="plus" size={16} /> Add New Teacher
                        </>
                    )}
                </button>
                {/* Shared by the add form and the inline edit field */}
                <datalist id="admin-department-options">
                    {departmentOptions.map((d) => (
                        <option key={d} value={d} />
                    ))}
                </datalist>
                {showAddTeacherForm && (
                    <form onSubmit={onAddTeacher} className="add-teacher-form">
                        <input type="text" placeholder="Teacher Name" aria-label="New teacher name" value={newTeacherName} onChange={(e) => setNewTeacherName(e.target.value)} required />
                        <input type="text" list="admin-department-options" autoComplete="off" maxLength={100} placeholder="Department (pick existing or type new)" aria-label="New teacher department" value={newTeacherDepartment} onChange={(e) => setNewTeacherDepartment(e.target.value)} required />
                        <input type="url" placeholder="Image URL (optional)" aria-label="New teacher image URL" value={newTeacherImage} onChange={(e) => setNewTeacherImage(e.target.value)} />
                        <button type="submit">Save Teacher</button>
                    </form>
                )}
            </div>

            <div className="admin-section">
                <h3>Manage Teachers</h3>

                {/* Broken photo URLs: preview then clean in one click */}
                <div className="admin-photo-tools">
                    {photoCleaned !== null ? (
                        <p className="admin-photo-done">
                            <Icon name="check" size={15} />
                            Cleared {photoCleaned} broken photo URL{photoCleaned === 1 ? '' : 's'}. Those teachers now show an initial avatar instead of a broken image.
                        </p>
                    ) : photoCheck === null ? (
                        <button
                            type="button"
                            className="admin-photo-btn"
                            onClick={handleCheckPhotos}
                            disabled={photoBusy}
                        >
                            <Icon name="search" size={15} />
                            {photoBusy ? 'Checking...' : 'Check for broken photos'}
                        </button>
                    ) : photoCheck.count === 0 ? (
                        <p className="admin-photo-done">
                            <Icon name="check" size={15} /> All teacher photo URLs look valid.
                        </p>
                    ) : (
                        <div className="admin-photo-warning" role="status">
                            <span>
                                <strong>{photoCheck.count}</strong> teacher{photoCheck.count === 1 ? '' : 's'} have a photo URL that isn't a real image file
                                {photoCheck.broken > 0 ? ` (${photoCheck.broken} missing a filename)` : ''}.
                                They show an initial avatar instead. Cleaning sets these URLs to empty.
                            </span>
                            <div className="admin-photo-actions">
                                <button type="button" onClick={handleCleanPhotos} disabled={photoBusy}>
                                    {photoBusy ? 'Cleaning...' : `Clean ${photoCheck.count} URL${photoCheck.count === 1 ? '' : 's'}`}
                                </button>
                                <button type="button" className="admin-photo-cancel" onClick={() => setPhotoCheck(null)} disabled={photoBusy}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <div className="search-box" style={{ marginBottom: '1rem' }}>
                    <label htmlFor="admin-teacher-search" className="admin-search-label">Search teachers</label>
                    <input
                        id="admin-teacher-search"
                        type="text"
                        placeholder="Search teachers by name or department..."
                        aria-label="Search teachers by name or department"
                        value={searchTerm}
                        onChange={onSearchChange}
                        className="search-input"
                    />
                    {searchTerm && (
                        <div className="search-info">
                            Found {searchResults.length} teacher{searchResults.length !== 1 ? 's' : ''} matching "{searchTerm}"
                        </div>
                    )}
                </div>

                <div className="teacher-sort-bar" style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '0 0 0.75rem' }}>
                    <label htmlFor="teacher-sort" style={{ fontSize: '0.85rem', fontWeight: 600, color: '#555' }}>Sort by</label>
                    <select
                        id="teacher-sort"
                        value={teacherSortKey}
                        onChange={(e) => {
                            const key = e.target.value as typeof teacherSortKey;
                            setTeacherSortKey(key);
                            // Sensible starting direction per field.
                            setTeacherSortDir(key === 'reviews' || key === 'newest' ? 'desc' : 'asc');
                        }}
                        style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #ddd', fontSize: '0.85rem', background: '#fff', color: '#333' }}
                    >
                        <option value="name">Name</option>
                        <option value="department">Department</option>
                        <option value="reviews">Reviews</option>
                        <option value="newest">Date added</option>
                    </select>
                    <button
                        type="button"
                        className="admin-mini-btn"
                        onClick={() => setTeacherSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
                        aria-label={teacherSortDir === 'asc' ? 'Reverse to descending' : 'Reverse to ascending'}
                        title="Reverse sort direction"
                    >
                        {sortDirLabel}
                    </button>
                    {sortLoading && <span style={{ fontSize: '0.8rem', fontWeight: 600, color: '#7a5320' }}>Updating...</span>}
                </div>

                <div className="admin-list">
                    {isSearching ? (
                        <div className="loading">Searching...</div>
                    ) :                        displayTeachers.length === 0 ? (
                            sortLoading ? (
                                <div className="loading">Loading teachers...</div>
                            ) : (
                                <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                                    {searchTerm ? 'No teachers found' : 'No teachers added yet'}
                                </p>
                            )
                        ) : (
                            sortedTeachers.map((teacher: Teacher) => {
                            const isEditing = editingTeacherId === teacher.id;
                            return (
                                <div key={teacher.id} className="admin-item">
                                    {isEditing ? (
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <input
                                                type="text"
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                placeholder="Name"
                                                aria-label="Edit teacher name"
                                                className="search-input"
                                                style={{ margin: 0 }}
                                            />
                                            <input
                                                type="text"
                                                value={editDepartment}
                                                onChange={(e) => setEditDepartment(e.target.value)}
                                                list="admin-department-options"
                                                autoComplete="off"
                                                maxLength={100}
                                                placeholder="Department"
                                                aria-label="Edit teacher department"
                                                className="search-input"
                                                style={{ margin: 0 }}
                                            />
                                            <input
                                                type="url"
                                                value={editImageUrl}
                                                onChange={(e) => setEditImageUrl(e.target.value)}
                                                placeholder="Image URL (optional)"
                                                aria-label="Edit teacher image URL"
                                                className="search-input"
                                                style={{ margin: 0 }}
                                            />
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button onClick={() => handleUpdate(teacher.id)} className="btn-submit" style={{ padding: '4px 12px' }}>Save</button>
                                                <button onClick={cancelEdit} className="btn-cancel" style={{ padding: '4px 12px' }}>Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <span><strong>{teacher.name}</strong> - {teacher.department}</span>
                                            <div>
                                                <button
                                                    onClick={() => toggleTeacherDetail(teacher.id)}
                                                    className="admin-mini-btn admin-mini-btn-info"
                                                    aria-label={`View details for ${teacher.name}`}
                                                    aria-expanded={detailTeacherId === teacher.id}
                                                >
                                                    {detailTeacherId === teacher.id ? 'Hide' : 'Details'}
                                                </button>
                                                <button onClick={() => startEdit(teacher)} className="edit-btn" style={{ marginRight: '8px' }} aria-label={`Edit ${teacher.name}`}>
                                                    <Icon name="edit" size={14} />
                                                </button>
                                                <button onClick={() => onDeleteTeacher(teacher.id)} className="delete-btn" disabled={adminMutationLoading}>Delete</button>
                                            </div>
                                        </>
                                    )}
                                    {detailTeacherId === teacher.id && (
                                        <div className="admin-teacher-detail">
                                            {detailLoading ? (
                                                <div className="loading">Loading details...</div>
                                            ) : teacherDetail ? (
                                                <>
                                                    <div className="admin-detail-header">
                                                        <Avatar
                                                            name={teacherDetail.teacher.name}
                                                            imageUrl={teacherDetail.teacher.image_url}
                                                            className="admin-detail-photo"
                                                            size={64}
                                                        />
                                                        <div className="admin-detail-title">
                                                            <strong>{teacherDetail.teacher.name}</strong>
                                                            <span>{teacherDetail.teacher.department}</span>
                                                        </div>
                                                    </div>
                                                    <div className="admin-detail-stats">
                                                        <div className="admin-stat-pill">
                                                            <span className="admin-stat-num">{teacherDetail.stats.total_reviews}</span>
                                                            <span className="admin-stat-label">Total</span>
                                                        </div>
                                                        <div className="admin-stat-pill admin-stat-approved">
                                                            <span className="admin-stat-num">{teacherDetail.stats.approved_reviews}</span>
                                                            <span className="admin-stat-label">Approved</span>
                                                        </div>
                                                        <div className="admin-stat-pill admin-stat-pending">
                                                            <span className="admin-stat-num">{teacherDetail.stats.pending_reviews}</span>
                                                            <span className="admin-stat-label">Pending</span>
                                                        </div>
                                                        <div className="admin-stat-pill admin-stat-questions">
                                                            <span className="admin-stat-num">{teacherDetail.stats.questions}</span>
                                                            <span className="admin-stat-label">Questions</span>
                                                        </div>
                                                    </div>
                                                    <div className="admin-detail-reviews">
                                                        <h4>All Reviews ({teacherDetail.stats.total_reviews})</h4>
                                                        {teacherDetail.reviews.length === 0 ? (
                                                            <p className="admin-detail-empty">No reviews for this teacher yet.</p>
                                                        ) : (
                                                            teacherDetail.reviews.map((review) => (
                                                                <div key={review.id} className={`admin-detail-review ${Number(review.is_approved) === 0 ? 'admin-detail-review-pending' : ''}`}>
                                                                    <div className="admin-detail-review-head">
                                                                        <strong>{review.user_name || 'Anonymous'}</strong>
                                                                        <span className="admin-detail-review-date">
                                                                            {new Date(review.created_at).toLocaleDateString()}
                                                                        </span>
                                                                        {review.moderation_flag === 'sensitive' && (
                                                                            <span className="admin-flag-badge admin-flag-sensitive" title="Contains a conduct allegation - review before publishing">Sensitive</span>
                                                                        )}
                                                                        {review.moderation_flag === 'bias' && (
                                                                            <span className="admin-flag-badge admin-flag-bias" title="Alleges favouritism or bias">Bias</span>
                                                                        )}
                                                                        {Number(review.open_reports) > 0 && (
                                                                            <span className="admin-flag-badge admin-flag-reported" title="Reported by readers">
                                                                                {review.open_reports} report{Number(review.open_reports) === 1 ? '' : 's'}
                                                                            </span>
                                                                        )}
                                                                        {Number(review.is_approved) === 0 && (
                                                    <>
                                                        <span className="admin-pending-badge">Pending</span>
                                                        <span style={{ display: 'inline-flex', gap: '6px' }}>
                                                            <button onClick={() => handleApproveReview(review.id)} className="admin-mini-btn admin-mini-approve" disabled={adminMutationLoading}>Approve</button>
                                                            <button onClick={() => handleRejectReview(review.id)} className="admin-mini-btn admin-mini-reject" disabled={adminMutationLoading}>Reject</button>
                                                        </span>
                                                    </>
                                                )}
                                                                    </div>
                                                                    {extractCourses(review).length > 0 && (
                                                                        <div className="admin-detail-review-courses">📖 {extractCourses(review).join(', ')}</div>
                                                                    )}
                                                                    {editingReviewId === review.id ? (
                                                                        renderReviewEditForm(review.id, Number(review.is_approved) === 0)
                                                                    ) : (
                                                                        <>
                                                                            <p>{review.comment}</p>
                                                                            <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
                                                                                <button onClick={() => startEditReview(review)} className="edit-btn" aria-label="Edit review" disabled={adminMutationLoading}>
                                                                                    <Icon name="edit" size={14} /> Edit
                                                                                </button>
                                                                                <button onClick={() => handleDeleteReview(review.id)} className="delete-btn" disabled={adminMutationLoading}>Delete</button>
                                                                            </div>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </>
                                            ) : (
                                                <div className="loading">Failed to load details.</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {!searchTerm && (
                    <>
                        {loadingMore && <div className="loading-more">Loading more teachers...</div>}
                        {!loadingMore && baseTeachers.length < totalTeachersCount && (
                            <button onClick={onLoadMore} className="load-more-btn" style={{ marginTop: '1rem', width: '100%' }}>
                                Load More ({baseTeachers.length} / {totalTeachersCount})
                            </button>
                        )}
                        {baseTeachers.length === totalTeachersCount && totalTeachersCount > 0 && (
                            <div className="end-of-list">You've seen all {totalTeachersCount} teachers</div>
                        )}
                    </>
                )}
            </div>
            </>
            )}

            {activeTab === 'reviews' && (
            <div className="admin-section">
                <h3>{reviewsPendingOnly ? 'Pending Reviews' : 'All Reviews'} ({reviewsPendingOnly ? pendingReviewsCount : totalReviews})</h3>
                {reviewsPendingOnly && (
                    <div style={{ margin: '0 0 12px' }}>
                        <button onClick={() => onTogglePendingOnly()} className="btn-cancel" style={{ padding: '4px 12px' }}>Show all reviews</button>
                    </div>
                )}
                {selectedPendingIds.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', margin: '0 0 12px', padding: '8px 12px', background: '#f4ecdd', borderRadius: '8px' }}>
                        <strong>{selectedPendingIds.length} selected</strong>
                        <button onClick={() => runBulkDecision('approve')} className="admin-mini-btn admin-mini-approve" disabled={adminMutationLoading}>Approve selected</button>
                        <button onClick={() => runBulkDecision('reject')} className="admin-mini-btn admin-mini-reject" disabled={adminMutationLoading}>Reject selected</button>
                        <button onClick={clearReviewSelection} className="btn-cancel" style={{ padding: '4px 12px' }}>Clear</button>
                    </div>
                )}
                <div className="admin-list">
                    {totalReviews === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No reviews yet.</p>
                    ) : reviewsPendingOnly && reviewsForModeration.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No pending reviews - all caught up!</p>
                    ) : (
                        reviewsForModeration.map((review: AdminReview) => {
                            const isReviewEditing = editingReviewId === review.id;
                            // Works for both 0/1 (MySQL) and false/true payloads.
                            const isPending = Number(review.is_approved) === 0;
                            return (
                            <div key={review.id} className="admin-item">
                                {isReviewEditing ? (
                                    renderReviewEditForm(review.id, isPending)
                                ) : (
                                <>
                                    {isPending && (
                                        <input
                                            type="checkbox"
                                            checked={selectedReviewIds.includes(review.id)}
                                            onChange={() => toggleReviewSelection(review.id)}
                                            aria-label={`Select review by ${review.user_name || 'Anonymous'}`}
                                            style={{ marginTop: '4px', width: '16px', height: '16px', cursor: 'pointer' }}
                                        />
                                    )}
                                    <div className="review-info">
                                        <strong>{review.teacher_name}</strong>
                                        {isPending && (
                                            <span className="admin-pending-badge" style={{ marginLeft: '8px' }}>Pending</span>
                                        )}
                                        {review.moderation_flag === 'sensitive' && (
                                            <span className="admin-flag-badge admin-flag-sensitive" style={{ marginLeft: '8px' }} title="Contains a conduct allegation - review before publishing">Sensitive</span>
                                        )}
                                        {review.moderation_flag === 'bias' && (
                                            <span className="admin-flag-badge admin-flag-bias" style={{ marginLeft: '8px' }} title="Alleges favouritism or bias">Bias</span>
                                        )}
                                        {Number(review.open_reports) > 0 && (
                                            <span className="admin-flag-badge admin-flag-reported" style={{ marginLeft: '8px' }} title="Reported by readers">
                                                {review.open_reports} report{Number(review.open_reports) === 1 ? '' : 's'}
                                            </span>
                                        )}
                                        <p style={{ marginTop: '8px', marginBottom: '5px' }}>&quot;{review.comment}&quot;</p>
                                        <small>
                                            <Icon name="user" size={12} /> {review.user_name || 'Anonymous'} | <Icon name="calendar" size={12} /> {new Date(review.created_at).toLocaleDateString()}
                                        </small>
                                        {extractCourses(review).length > 0 && (
                                            <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                                                {extractCourses(review).map((c: string, i: number) => (
                                                    <span key={i} style={{ fontSize: '0.75rem', background: '#f1e8d9', color: '#7a5320', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>{c}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                                        <button onClick={() => startEditReview(review)} className="edit-btn" aria-label="Edit review" disabled={adminMutationLoading}>
                                            <Icon name="edit" size={14} />
                                        </button>
                                        {isPending && (
                                            <>
                                                <button onClick={() => handleApproveReview(review.id)} className="admin-mini-btn admin-mini-approve" disabled={adminMutationLoading}>Approve</button>
                                                <button onClick={() => handleRejectReview(review.id)} className="admin-mini-btn admin-mini-reject" disabled={adminMutationLoading}>Reject</button>
                                            </>
                                        )}
                                        <button onClick={() => handleDeleteReview(review.id)} className="delete-btn" disabled={adminMutationLoading}>Delete</button>
                                    </div>
                                </>
                                )}
                            </div>
                            );
                        })
                    )}
                </div>
                {!adminLoadingMoreReviews && adminReviewsPage < adminReviewsTotalPages && (
                    <button onClick={onLoadMoreReviews} className="load-more-btn" style={{ marginTop: '1rem', width: '100%' }}>
                        Load More Reviews
                    </button>
                )}
                {adminLoadingMoreReviews && <div className="loading-more">Loading more reviews...</div>}
            </div>
            )}

            {activeTab === 'qa' && (
            <div className="admin-section">
                <h3>All Questions ({adminQuestions.length})</h3>
                <div className="admin-list">
                    {adminQuestions.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No questions yet.</p>
                    ) : (
                        adminQuestions.map((question: AdminQuestion) => {
                            const questionPending = Number(question.is_approved) === 0;
                            return (
                            <div key={question.id} className="admin-item">
                                <div className="review-info">
                                    <strong>{question.teacher_name}</strong>
                                    {questionPending && (
                                        <span className="admin-pending-badge" style={{ marginLeft: '8px' }}>Pending</span>
                                    )}
                                    <p style={{ marginTop: '8px', marginBottom: '5px' }}>"{question.question}"</p>
                                    <small>
                                        <Icon name="message-circle" size={12} /> {question.answer_count} answer{question.answer_count !== 1 ? 's' : ''} | <Icon name="calendar" size={12} /> {new Date(question.created_at).toLocaleDateString()}
                                    </small>
                                    {(question.answers || []).length > 0 && (
                                        <div style={{ marginTop: '8px', paddingLeft: '12px', borderLeft: '2px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            {(question.answers || []).map((ans) => (
                                                <div key={ans.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    <span style={{ flex: 1, fontSize: '0.85rem', color: '#334155' }}>"{ans.answer}"</span>
                                                    {Number(ans.is_approved) === 0 && (
                                                        <>
                                                            <span className="admin-pending-badge">Pending</span>
                                                            <button onClick={() => onUpdateAnswer(ans.id, { is_approved: true })} className="admin-mini-btn admin-mini-approve" disabled={adminMutationLoading}>Approve</button>
                                                            <button onClick={() => onUpdateAnswer(ans.id, { is_approved: false })} className="admin-mini-btn admin-mini-reject" disabled={adminMutationLoading}>Reject</button>
                                                        </>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                    {questionPending && (
                                        <>
                                            <button onClick={() => onUpdateQuestion(question.id, { is_approved: true })} className="admin-mini-btn admin-mini-approve" disabled={adminMutationLoading || adminLoadingMoreQuestions}>Approve</button>
                                            <button onClick={() => onUpdateQuestion(question.id, { is_approved: false })} className="admin-mini-btn admin-mini-reject" disabled={adminMutationLoading || adminLoadingMoreQuestions}>Reject</button>
                                        </>
                                    )}
                                    <button
                                        onClick={() => onDeleteQuestion(question.id)}
                                        className="delete-btn"
                                        disabled={adminMutationLoading || adminLoadingMoreQuestions}
                                    >
                                        Delete
                                    </button>
                                </div>
                            </div>
                            );
                        })
                    )}
                </div>
                {!adminLoadingMoreQuestions && adminQuestionsPage < adminQuestionsTotalPages && (
                    <button onClick={onLoadMoreQuestions} className="load-more-btn" style={{ marginTop: '1rem', width: '100%' }}>
                        Load More Questions
                    </button>
                )}
                {adminLoadingMoreQuestions && <div className="loading-more">Loading more questions...</div>}
            </div>
            )}

            {activeTab === 'courses' && (
            <div className="admin-section">
                <h3>Custom Courses ({visibleCourses.length})</h3>
                <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 12px' }}>
                    Courses added by students. Approved courses appear in the review form dropdown for everyone. Rejected courses are removed from this list.
                </p>
                <div className="admin-list">
                    {visibleCourses.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No custom courses suggested yet.</p>
                    ) : (
                        visibleCourses.map((course: CustomCourse) => (
                            <div key={course.id} className="admin-item">
                                <div className="review-info">
                                    <strong>{course.name}</strong>
                                    <small style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px' }}>
                                        <span
                                            style={{
                                                fontWeight: 700,
                                                fontSize: '0.7rem',
                                                padding: '2px 8px',
                                                borderRadius: '10px',
                                                color: '#fff',
                                                background: course.status === 'pending' ? '#f59e0b' : course.status === 'approved' ? '#10b981' : '#ef4444'
                                            }}
                                        >
                                            {course.status.toUpperCase()}
                                        </span>
                                        | <Icon name="book-open" size={12} /> used {course.times_used} time{course.times_used !== 1 ? 's' : ''}
                                        {course.reviewed_at && <> | <Icon name="calendar" size={12} /> {new Date(course.reviewed_at).toLocaleDateString()}</>}
                                    </small>
                                </div>
                                <div className="admin-item-actions">
                                    {course.status !== 'approved' && (
                                        <button
                                            onClick={() => onReviewCourse(course.id, 'approve')}
                                            className="admin-mini-btn admin-mini-approve"
                                            disabled={adminMutationLoading}
                                        >
                                            Approve
                                        </button>
                                    )}
                                    {course.status !== 'rejected' && (
                                        <button
                                            onClick={() => onReviewCourse(course.id, 'reject')}
                                            className="admin-mini-btn admin-mini-reject"
                                            disabled={adminMutationLoading}
                                        >
                                            {course.status === 'approved' ? 'Undo' : 'Reject'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
            )}

            {activeTab === 'reports' && (
            <div className="admin-section">
                <h3>Reader Reports ({reports.length}{adminReportsTotalPages > adminReportsPage ? '+' : ''})</h3>
                <p style={{ color: '#64748b', fontSize: '0.85rem', margin: '0 0 12px' }}>
                    Students can flag a published review. Read the review, then resolve the report or dismiss it when there is nothing to fix.
                </p>
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                    {(['open', 'resolved', 'dismissed'] as const).map((status) => (
                        <button
                            key={status}
                            className={`admin-mini-btn${reportsStatus === status ? ' admin-mini-approve' : ''}`}
                            onClick={() => onReportsStatusChange(status)}
                            disabled={adminMutationLoading}
                            aria-pressed={reportsStatus === status}
                        >
                            {status.charAt(0).toUpperCase() + status.slice(1)}
                        </button>
                    ))}
                </div>
                <div className="admin-list">
                    {reports.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No {reportsStatus} reports.</p>
                    ) : (
                        reports.map((report) => (
                            <div key={report.id} className="admin-item" style={{ alignItems: 'flex-start' }}>
                                <div className="review-info">
                                    <strong>{report.teacher_name} · review #{report.review_id}</strong>
                                    <small style={{ display: 'block', marginTop: '4px' }}>
                                        Reported {new Date(report.created_at).toLocaleDateString()} by a reader
                                    </small>
                                    <p style={{ margin: '6px 0', fontStyle: 'italic' }}>&quot;{report.reason}&quot;</p>
                                    <p style={{ margin: 0, color: '#475569' }}>{report.comment}</p>
                                    <small style={{ color: '#64748b' }}>
                                        {report.user_name || 'Anonymous'} · {Number(report.is_approved) ? 'Approved' : 'Pending'}
                                    </small>
                                </div>
                                <div className="admin-item-actions">
                                    {report.status !== 'resolved' && (
                                        <button onClick={() => onUpdateReportStatus(report.id, 'resolved')} className="admin-mini-btn admin-mini-approve" disabled={adminMutationLoading}>
                                            Resolve
                                        </button>
                                    )}
                                    {report.status !== 'dismissed' && (
                                        <button onClick={() => onUpdateReportStatus(report.id, 'dismissed')} className="admin-mini-btn admin-mini-reject" disabled={adminMutationLoading}>
                                            Dismiss
                                        </button>
                                    )}
                                    {report.status !== 'open' && (
                                        <button onClick={() => onUpdateReportStatus(report.id, 'open')} className="admin-mini-btn" disabled={adminMutationLoading}>
                                            Reopen
                                        </button>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                </div>
                {adminReportsPage < adminReportsTotalPages && (
                    <button onClick={onLoadMoreReports} className="add-teacher-btn" disabled={adminLoadingMoreReports} style={{ marginTop: '12px' }}>
                        {adminLoadingMoreReports ? 'Loading…' : 'Load more reports'}
                    </button>
                )}
            </div>
            )}
        </div>
    );
});

export default AdminPanel;
