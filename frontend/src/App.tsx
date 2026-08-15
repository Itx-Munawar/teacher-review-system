import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { useSearchParams, useParams, useNavigate, Link } from 'react-router-dom';
import {
    getTeachers,
    getDepartments,
    getRelatedTeachers,
    searchAllTeachers,
    getTeacherDetail,
    adminLogin,
    adminMe,
    adminLogout,
    addTeacher,
    updateTeacher,
    deleteTeacher,
    deleteReview,
    getAdminReviews,
    getAdminQuestions,
    deleteQuestion,
    submitReview,
    type AdminQuestion
} from './services/api';
import { debounce } from './utils/debounce';
import ParticleBackground from './components/ParticleBackground';
import TiltCard from './components/TiltCard';
import LazySection from './components/LazySection';
import TeacherAutocomplete from './components/TeacherAutocomplete';
import QASection from './components/QASection';
import InstallPrompt from './components/InstallPrompt';
import PullToRefresh from './components/PullToRefresh';
import Icon from './components/Icon';
import Avatar from './components/Avatar';
import EmptyState from './components/EmptyState';
import BottomNav from './components/BottomNav';
import { haptic } from './utils/haptics';
import './App.css';

// ========== INTERFACES ==========
interface Teacher {
    id: number;
    name: string;
    department: string;
    review_count: number;
    created_at?: string;
    image_url?: string;
}

interface Review {
    id: number;
    teacher_id: number;
    comment: string;
    user_name: string;
    created_at: string;
}

interface TeacherDetail extends Teacher {
    reviews: Review[];
    total_reviews: number;
}

interface AdminReview {
    id: number;
    teacher_id: number;
    teacher_name: string;
    comment: string;
    user_name: string;
    created_at: string;
}

interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info';
}

// ========== TOASTS ==========
const ToastHost = memo(({ toasts }: { toasts: Toast[] }) => (
    <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
            <div key={t.id} className={`toast toast-${t.type}`} role="status">
                {t.message}
            </div>
        ))}
    </div>
));

// ========== ADMIN PANEL ==========
interface AdminPanelProps {
    teachers: Teacher[];
    reviewsForModeration: AdminReview[];
    onAddTeacher: (e: React.FormEvent) => void;
    onDeleteTeacher: (id: number) => void;
    onUpdateTeacher: (id: number, data: { name: string; department: string; image_url?: string }) => void;
    onDeleteReview: (id: number) => void;
    onLogout: () => void;
    showAddTeacherForm: boolean;
    setShowAddTeacherForm: (v: boolean) => void;
    newTeacherName: string;
    setNewTeacherName: (v: string) => void;
    newTeacherDepartment: string;
    setNewTeacherDepartment: (v: string) => void;
    newTeacherImage: string;
    setNewTeacherImage: (v: string) => void;
    totalTeachersCount: number;
    loadingMore: boolean;
    onLoadMore: () => void;
    adminSearchTerm: string;
    onAdminSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    adminSearchResults: Teacher[];
    adminIsSearching: boolean;
    onLoadMoreReviews: () => void;
    adminLoadingMoreReviews: boolean;
    adminReviewsTotalPages: number;
    adminReviewsPage: number;
    adminQuestions: AdminQuestion[];
    onDeleteQuestion: (id: number) => void;
    adminLoadingMoreQuestions: boolean;
    adminQuestionsPage: number;
    adminQuestionsTotalPages: number;
    onLoadMoreQuestions: () => void;
}

const AdminPanel = memo(({
    teachers,
    reviewsForModeration,
    onAddTeacher,
    onDeleteTeacher,
    onUpdateTeacher,
    onDeleteReview,
    onLogout,
    showAddTeacherForm,
    setShowAddTeacherForm,
    newTeacherName,
    setNewTeacherName,
    newTeacherDepartment,
    setNewTeacherDepartment,
    newTeacherImage,
    setNewTeacherImage,
    totalTeachersCount,
    loadingMore,
    onLoadMore,
    adminSearchTerm,
    onAdminSearchChange,
    adminSearchResults,
    adminIsSearching,
    onLoadMoreReviews,
    adminLoadingMoreReviews,
    adminReviewsTotalPages,
    adminReviewsPage,
    adminQuestions,
    onDeleteQuestion,
    adminLoadingMoreQuestions,
    adminQuestionsPage,
    adminQuestionsTotalPages,
    onLoadMoreQuestions
}: AdminPanelProps) => {
    const totalReviews = reviewsForModeration?.length || 0;

    const displayTeachers = adminSearchTerm ? adminSearchResults : teachers;

    // Edit state
    const [editingTeacherId, setEditingTeacherId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editDepartment, setEditDepartment] = useState('');
    const [editImageUrl, setEditImageUrl] = useState('');
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

    return (
        <div className="admin-panel">
            <div className="admin-header">
                <h2 className="gradient-text">Admin Dashboard</h2>
                <div className="admin-stats">
                    <span><Icon name="book" size={15} /> {totalTeachersCount || teachers.length} Teachers</span>
                    <span><Icon name="message-circle" size={15} /> {totalReviews} Reviews</span>
                </div>
                <button onClick={onLogout} className="logout-btn">Logout</button>
            </div>

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
                {showAddTeacherForm && (
                    <form onSubmit={onAddTeacher} className="add-teacher-form">
                        <input type="text" placeholder="Teacher Name" aria-label="New teacher name" value={newTeacherName} onChange={(e) => setNewTeacherName(e.target.value)} required />
                        <input type="text" placeholder="Department" aria-label="New teacher department" value={newTeacherDepartment} onChange={(e) => setNewTeacherDepartment(e.target.value)} required />
                        <input type="url" placeholder="Image URL (optional)" aria-label="New teacher image URL" value={newTeacherImage} onChange={(e) => setNewTeacherImage(e.target.value)} />
                        <button type="submit">Save Teacher</button>
                    </form>
                )}
            </div>

            <div className="admin-section">
                <h3>Manage Teachers</h3>
                <div className="search-box" style={{ marginBottom: '1rem' }}>
                    <input
                        type="text"
                        placeholder="Search teachers by name or department..."
                        aria-label="Search teachers by name or department"
                        value={adminSearchTerm}
                        onChange={onAdminSearchChange}
                        className="search-input"
                    />
                    {adminSearchTerm && (
                        <div className="search-info">
                            Found {adminSearchResults.length} teacher{adminSearchResults.length !== 1 ? 's' : ''} matching "{adminSearchTerm}"
                        </div>
                    )}
                </div>

                <div className="admin-list">
                    {adminIsSearching ? (
                        <div className="loading">Searching...</div>
                    ) : displayTeachers.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                            {adminSearchTerm ? 'No teachers found' : 'No teachers added yet'}
                        </p>
                    ) : (
                        displayTeachers.map((teacher: Teacher) => {
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
                                                <button onClick={() => startEdit(teacher)} className="edit-btn" style={{ marginRight: '8px' }} aria-label={`Edit ${teacher.name}`}>
                                                    <Icon name="edit" size={14} />
                                                </button>
                                                <button onClick={() => onDeleteTeacher(teacher.id)} className="delete-btn">Delete</button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {!adminSearchTerm && (
                    <>
                        {loadingMore && <div className="loading-more">Loading more teachers...</div>}
                        {!loadingMore && teachers.length < totalTeachersCount && (
                            <button onClick={onLoadMore} className="load-more-btn" style={{ marginTop: '1rem', width: '100%' }}>
                                Load More ({teachers.length} / {totalTeachersCount})
                            </button>
                        )}
                        {teachers.length === totalTeachersCount && totalTeachersCount > 0 && (
                            <div className="end-of-list">You've seen all {totalTeachersCount} teachers</div>
                        )}
                    </>
                )}
            </div>

            <div className="admin-section">
                <h3>Manage Reviews ({totalReviews})</h3>
                <div className="admin-list">
                    {totalReviews === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No reviews yet.</p>
                    ) : (
                        reviewsForModeration.map((review: AdminReview) => (
                            <div key={review.id} className="admin-item">
                                <div className="review-info">
                                    <strong>{review.teacher_name}</strong>
                                    <p style={{ marginTop: '8px', marginBottom: '5px' }}>"{review.comment}"</p>
                                    <small>
                                        <Icon name="user" size={12} /> {review.user_name || 'Anonymous'} | <Icon name="calendar" size={12} /> {new Date(review.created_at).toLocaleDateString()}
                                    </small>
                                </div>
                                <button onClick={() => onDeleteReview(review.id)} className="delete-btn">Delete</button>
                            </div>
                        ))
                    )}
                </div>
                {!adminLoadingMoreReviews && adminReviewsPage < adminReviewsTotalPages && (
                    <button onClick={onLoadMoreReviews} className="load-more-btn" style={{ marginTop: '1rem', width: '100%' }}>
                        Load More Reviews
                    </button>
                )}
                {adminLoadingMoreReviews && <div className="loading-more">Loading more reviews...</div>}
            </div>

            <div className="admin-section">
                <h3>Manage Questions ({adminQuestions.length})</h3>
                <div className="admin-list">
                    {adminQuestions.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No questions yet.</p>
                    ) : (
                        adminQuestions.map((question: AdminQuestion) => (
                            <div key={question.id} className="admin-item">
                                <div className="review-info">
                                    <strong>{question.teacher_name}</strong>
                                    <p style={{ marginTop: '8px', marginBottom: '5px' }}>"{question.question}"</p>
                                    <small>
                                        <Icon name="message-circle" size={12} /> {question.answer_count} answer{question.answer_count !== 1 ? 's' : ''} | <Icon name="calendar" size={12} /> {new Date(question.created_at).toLocaleDateString()}
                                    </small>
                                </div>
                                <button
                                    onClick={() => onDeleteQuestion(question.id)}
                                    className="delete-btn"
                                    disabled={adminLoadingMoreQuestions}
                                >
                                    Delete
                                </button>
                            </div>
                        ))
                    )}
                </div>
                {!adminLoadingMoreQuestions && adminQuestionsPage < adminQuestionsTotalPages && (
                    <button onClick={onLoadMoreQuestions} className="load-more-btn" style={{ marginTop: '1rem', width: '100%' }}>
                        Load More Questions
                    </button>
                )}
                {adminLoadingMoreQuestions && <div className="loading-more">Loading more questions...</div>}
            </div>
        </div>
    );
});

// ========== LOGIN FORM ==========
interface LoginFormProps {
    adminUsername: string;
    setAdminUsername: (v: string) => void;
    adminPassword: string;
    setAdminPassword: (v: string) => void;
    adminError: string;
    onLogin: (e: React.FormEvent) => void;
}

const LoginForm = memo(({
    adminUsername,
    setAdminUsername,
    adminPassword,
    setAdminPassword,
    adminError,
    onLogin
}: LoginFormProps) => (
    <div className="login-form-container">
        <div className="login-form">
            <h2 className="gradient-text">Admin Login</h2>
            <form onSubmit={onLogin}>
                <input
                    type="text"
                    placeholder="Username"
                    aria-label="Username"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    required
                    autoFocus
                />
                <input
                    type="password"
                    placeholder="Password"
                    aria-label="Password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    required
                />
                {adminError && <div className="error-message">{adminError}</div>}
                <button type="submit">Login</button>
            </form>
            <p style={{ textAlign: 'center', marginTop: '15px' }}>
                <a href="/forgot-password" style={{ color: '#667eea' }}>Forgot Password?</a>
            </p>
        </div>
    </div>
));

// ========== MAIN APP ==========
const App: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { id: teacherIdParam } = useParams();
    const navigate = useNavigate();

    // State
    const [teachers, setTeachers] = useState<Teacher[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);
    const [currentPage, setCurrentPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [totalTeachersCount, setTotalTeachersCount] = useState(0);
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<Teacher[]>([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState<string | null>(null);

    const [selectedTeacher, setSelectedTeacher] = useState<TeacherDetail | null>(null);
    const [relatedTeachers, setRelatedTeachers] = useState<Teacher[]>([]);
    const [compareList, setCompareList] = useState<Teacher[]>([]);
    const [isComparing, setIsComparing] = useState(false);
    const [compareDetails, setCompareDetails] = useState<TeacherDetail[]>([]);
    const [compareLoading, setCompareLoading] = useState(false);
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [reviewComment, setReviewComment] = useState('');
    const [reviewUserName, setReviewUserName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [reviewError, setReviewError] = useState('');
    const [reviewSuccess, setReviewSuccess] = useState('');

    const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
    const [showAdminPanel, setShowAdminPanel] = useState(false);
    const [adminUsername, setAdminUsername] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [adminError, setAdminError] = useState('');
    const [showAddTeacherForm, setShowAddTeacherForm] = useState(false);
    const [newTeacherName, setNewTeacherName] = useState('');
    const [newTeacherDepartment, setNewTeacherDepartment] = useState('');
    const [newTeacherImage, setNewTeacherImage] = useState('');
    const [reviewsForModeration, setReviewsForModeration] = useState<AdminReview[]>([]);

    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastIdRef = useRef(0);

    const mainContentRef = useRef<HTMLDivElement>(null);
    const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const listScrollPosRef = useRef(0);
    const searchInputRef = useRef<HTMLInputElement>(null);

    const [showAboutModal, setShowAboutModal] = useState(false);
    const [showContactModal, setShowContactModal] = useState(false);
    const [showMobileMenu, setShowMobileMenu] = useState(false);
    const [headerScrolled, setHeaderScrolled] = useState(false);

    // Compact sticky header once the user scrolls past the hero
    useEffect(() => {
        const onScroll = () => setHeaderScrolled(window.scrollY > 80);
        window.addEventListener('scroll', onScroll, { passive: true });
        onScroll();
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    const [adminSearchTerm, setAdminSearchTerm] = useState('');
    const [adminSearchResults, setAdminSearchResults] = useState<Teacher[]>([]);
    const [adminIsSearching, setAdminIsSearching] = useState(false);

    const [sortBy, setSortBy] = useState('name');
    const [departmentFilter, setDepartmentFilter] = useState('');
    const [departments, setDepartments] = useState<{ department: string; teacher_count: number }[]>([]);

    // ========== TOASTS ==========
    const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
        const id = ++toastIdRef.current;
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 4000);
    }, []);

    // ========== TEACHER LOADING (PAGINATED) ==========
    const loadTeachers = useCallback(async (page: number = 1, retryCount: number = 0) => {
        try {
            if (page === 1) setLoading(true);
            else setLoadingMore(true);
            setError(null);

            const response = await getTeachers(page, sortBy, departmentFilter || undefined);
            const data = response.data;
            const newTeachers = data.teachers || [];

            if (page === 1) {
                setTeachers(newTeachers);
            } else {
                setTeachers(prev => [...prev, ...newTeachers]);
            }

            if (data.pagination) {
                setHasMore(page < data.pagination.totalPages);
                setTotalTeachersCount(data.pagination.total);
            }
        } catch (err: any) {
            console.error('Failed to load teachers:', err);
            if (retryCount === 0 && (err.code === 'ECONNABORTED' || err.message?.includes('timeout'))) {
                console.log('Auto-retrying after timeout...');
                setTimeout(() => loadTeachers(page, 1), 2000);
                return;
            }
            setError('Failed to load teachers. Please refresh the page.');
        } finally {
            if (page === 1) setLoading(false);
            else setLoadingMore(false);
        }
    }, [sortBy, departmentFilter]);

    // Load departments once for the filter dropdown
    useEffect(() => {
        getDepartments().then((res) => {
            if (res.data && Array.isArray(res.data)) setDepartments(res.data);
        }).catch(() => { /* ignore */ });
    }, []);

    // Pull-to-refresh reloads the teacher list from page 1
    const handlePullRefresh = useCallback(() => loadTeachers(1), [loadTeachers]);

    // ========== SEARCH (AUTOCOMPLETE ONLY) ==========
    // The old behavior replaced the sidebar list while typing; that duplicated
    // the autocomplete dropdown. Now typing only drives the dropdown, and the
    // sidebar list stays unchanged until a teacher is selected.
    const performSearch = useCallback(async (value: string) => {
        setIsSearching(true);
        setLoading(true);
        try {
            const res = await searchAllTeachers(value);
            setSearchResults(res.data || []);
        } catch (searchErr) {
            console.error('Search error:', searchErr);
            setSearchResults([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const debouncedSearch = useRef(debounce((value: string) => { performSearch(value); }, 350));

    const handleSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setSearchTerm(value);

        if (value) {
            setSearchParams({ search: value });
        } else {
            setSearchParams((prev) => {
                const next = new URLSearchParams(prev);
                next.delete('search');
                return next;
            });
        }

        // Do NOT replace the sidebar list while typing – the autocomplete
        // dropdown handles suggestions. Only reload the full list on clear.
        if (!value.trim()) {
            setIsSearching(false);
            setSearchResults([]);
            setCurrentPage(1);
            loadTeachers(1);
        }
    }, [setSearchParams, loadTeachers]);

    const handleAdminSearch = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAdminSearchTerm(value);

        if (value.trim()) {
            setAdminIsSearching(true);
            try {
                const res = await searchAllTeachers(value);
                setAdminSearchResults(res.data || []);
            } catch (error) {
                console.error('Admin search error:', error);
                setAdminSearchResults([]);
            } finally {
                setAdminIsSearching(false);
            }
        } else {
            setAdminIsSearching(false);
            setAdminSearchResults([]);
        }
    }, []);

    // ========== ADMIN DATA ==========
    const [adminReviewsPage, setAdminReviewsPage] = useState(1);
    const [adminReviewsTotalPages, setAdminReviewsTotalPages] = useState(1);
    const [adminLoadingMoreReviews, setAdminLoadingMoreReviews] = useState(false);
    const [adminQuestions, setAdminQuestions] = useState<AdminQuestion[]>([]);
    const [adminQuestionsPage, setAdminQuestionsPage] = useState(1);
    const [adminQuestionsTotalPages, setAdminQuestionsTotalPages] = useState(1);
    const [adminLoadingMoreQuestions, setAdminLoadingMoreQuestions] = useState(false);

    const loadAdminData = useCallback(async () => {
        const [reviewsResult, questionsResult] = await Promise.allSettled([
            getAdminReviews(1, 50),
            getAdminQuestions(1, 50)
        ]);

        let reviewsData: AdminReview[] = [];
        let totalPages = 1;
        if (reviewsResult.status === 'fulfilled') {
            const reviewsRes = reviewsResult.value;
            if (reviewsRes.data) {
                if (Array.isArray(reviewsRes.data)) {
                    reviewsData = reviewsRes.data;
                } else if (reviewsRes.data.reviews) {
                    reviewsData = reviewsRes.data.reviews;
                    totalPages = reviewsRes.data.pagination?.totalPages || 1;
                } else if (reviewsRes.data.data) {
                    reviewsData = reviewsRes.data.data;
                }
            }
        } else {
            console.error('Error loading admin reviews:', reviewsResult.reason);
        }

        let questionsData: AdminQuestion[] = [];
        let questionsTotalPages = 1;
        if (questionsResult.status === 'fulfilled') {
            const questionsRes = questionsResult.value;
            if (questionsRes.data?.questions) {
                questionsData = questionsRes.data.questions;
                questionsTotalPages = questionsRes.data.pagination?.totalPages || 1;
            }
        } else {
            console.error('Error loading admin questions:', questionsResult.reason);
        }

        setAdminReviewsTotalPages(totalPages);
        setAdminQuestionsTotalPages(questionsTotalPages);
        setReviewsForModeration(reviewsData);
        setAdminQuestions(questionsData);
        setAdminReviewsPage(1);
        setAdminQuestionsPage(1);
    }, []);

    const handleLoadMoreReviews = useCallback(async () => {
        const nextPage = adminReviewsPage + 1;
        if (nextPage > adminReviewsTotalPages || adminLoadingMoreReviews) return;
        setAdminLoadingMoreReviews(true);
        try {
            const reviewsRes = await getAdminReviews(nextPage, 50);
            const reviewsData = reviewsRes.data?.reviews || [];
            setReviewsForModeration(prev => [...prev, ...reviewsData]);
            setAdminReviewsPage(nextPage);
        } catch (error) {
            console.error('Error loading more reviews:', error);
            showToast('Failed to load more reviews', 'error');
        } finally {
            setAdminLoadingMoreReviews(false);
        }
    }, [adminReviewsPage, adminReviewsTotalPages, adminLoadingMoreReviews, showToast]);

    const handleLoadMoreQuestions = useCallback(async () => {
        const nextPage = adminQuestionsPage + 1;
        if (nextPage > adminQuestionsTotalPages || adminLoadingMoreQuestions) return;
        setAdminLoadingMoreQuestions(true);
        try {
            const questionsRes = await getAdminQuestions(nextPage, 50);
            const questionsData = questionsRes.data?.questions || [];
            setAdminQuestions(prev => [...prev, ...questionsData]);
            setAdminQuestionsPage(nextPage);
        } catch (error) {
            console.error('Error loading more questions:', error);
            showToast('Failed to load more questions', 'error');
        } finally {
            setAdminLoadingMoreQuestions(false);
        }
    }, [adminQuestionsPage, adminQuestionsTotalPages, adminLoadingMoreQuestions, showToast]);

    // Effects
    useEffect(() => {
        if (!isSearching && currentPage > 1) {
            loadTeachers(currentPage);
        }
    }, [currentPage, isSearching, loadTeachers]);

    // Reload page 1 when sort or department filter changes
    useEffect(() => {
        if (!isSearching) {
            setCurrentPage(1);
            loadTeachers(1);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sortBy, departmentFilter]);

    useEffect(() => {
        loadTeachers(1);
        checkAdminLogin();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (isAdminLoggedIn) {
            loadAdminData();
            loadTeachers(1);
        }
    }, [isAdminLoggedIn, loadAdminData, loadTeachers]);

    // Restore state from URL on mount
    useEffect(() => {
        const teacherId = teacherIdParam || searchParams.get('teacher');
        const searchQuery = searchParams.get('search');

        if (searchQuery) {
            setSearchTerm(searchQuery);
            performSearch(searchQuery);
        }

        if (teacherId) {
            (async () => {
                try {
                    const response = await getTeacherDetail(parseInt(teacherId));
                    const data = response.data;
                    const teacherInfo = data.teacher;
                    const reviewsList = data.reviews || [];
                    const totalReviews = data.total_reviews || 0;
                    const teacherData: TeacherDetail = {
                        id: teacherInfo.id,
                        name: teacherInfo.name,
                        department: teacherInfo.department,
                        review_count: totalReviews,
                        total_reviews: totalReviews,
                        image_url: teacherInfo.image_url || null,
                        reviews: reviewsList,
                    };
                    setSelectedTeacher(teacherData);
                } catch (err) {
                    console.error('Failed to restore teacher:', err);
                }
            })();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Sync teacher detail when navigating between /teacher/:id pages (back/forward)
    useEffect(() => {
        if (!teacherIdParam) return;
        if (selectedTeacher && selectedTeacher.id === parseInt(teacherIdParam)) return;
        (async () => {
            try {
                const response = await getTeacherDetail(parseInt(teacherIdParam));
                const data = response.data;
                const teacherInfo = data.teacher;
                const reviewsList = data.reviews || [];
                const totalReviews = data.total_reviews || 0;
                const teacherData: TeacherDetail = {
                    id: teacherInfo.id,
                    name: teacherInfo.name,
                    department: teacherInfo.department,
                    review_count: totalReviews,
                    total_reviews: totalReviews,
                    image_url: teacherInfo.image_url || null,
                    reviews: reviewsList,
                };
                setSelectedTeacher(teacherData);
            } catch (err) {
                console.error('Failed to restore teacher:', err);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [teacherIdParam]);

    // Load related teachers in the same department
    useEffect(() => {
        if (!selectedTeacher) {
            setRelatedTeachers([]);
            return;
        }
        getRelatedTeachers(selectedTeacher.id).then((res) => {
            if (res.data && Array.isArray(res.data)) setRelatedTeachers(res.data);
        }).catch(() => setRelatedTeachers([]));
    }, [selectedTeacher?.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // Dynamic page title for SEO (teacher detail / search / default)
    useEffect(() => {
        const metaDescription = document.querySelector('meta[name="description"]');
        if (selectedTeacher) {
            document.title = `${selectedTeacher.name} - ${selectedTeacher.department} | UMT Teacher Reviews`;
            if (metaDescription) {
                metaDescription.setAttribute(
                    'content',
                    `Read anonymous student reviews for ${selectedTeacher.name} (${selectedTeacher.department}) at UMT Lahore. See how ${selectedTeacher.review_count || 0} students rated their teaching experience.`
                );
            }
        } else if (searchTerm) {
            document.title = `Search "${searchTerm}" | UMT Teacher Reviews`;
            if (metaDescription) {
                metaDescription.setAttribute(
                    'content',
                    `Search results for "${searchTerm}" among UMT teachers. Read anonymous student reviews at UMT Teacher Reviews.`
                );
            }
        } else {
            document.title = 'UMT Teacher Reviews – Anonymous Reviews for UMT Professors';
            if (metaDescription) {
                metaDescription.setAttribute(
                    'content',
                    'Read and write anonymous reviews for UMT teachers. Find the best professors at University of Management and Technology, Lahore.'
                );
            }
        }
    }, [selectedTeacher, searchTerm]);

    const checkAdminLogin = useCallback(async () => {        try {
            await adminMe();
            setIsAdminLoggedIn(true);
        } catch {
            setIsAdminLoggedIn(false);
        }
    }, []);

    const handleAdminLogin = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        setAdminError('');
        try {
            await adminLogin(adminUsername, adminPassword);
            setIsAdminLoggedIn(true);
            setAdminUsername('');
            setAdminPassword('');
            showToast('Admin login successful!', 'success');
            await loadAdminData();
            await loadTeachers(1);
        } catch (error: any) {
            setAdminError(error.response?.data?.error || 'Login failed');
        }
    }, [adminUsername, adminPassword, loadAdminData, loadTeachers, showToast]);

    const handleAdminLogout = useCallback(async () => {
        try {
            await adminLogout();
        } catch (error) {
            console.error('Logout error:', error);
        }
        setIsAdminLoggedIn(false);
        setShowAdminPanel(false);
        setShowAddTeacherForm(false);
        if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
        showToast('Logged out successfully', 'info');
    }, [showToast]);

    // ---------- Auto-logout timer (admin only) ----------
    const startLogoutTimer = useCallback(() => {
        if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = setTimeout(() => {
            if (isAdminLoggedIn && showAdminPanel) {
                console.log('Auto-logging out due to inactivity');
                handleAdminLogout();
                setShowAdminPanel(false);
                showToast('You have been logged out due to inactivity.', 'info');
            }
        }, 30 * 60 * 1000);
    }, [isAdminLoggedIn, showAdminPanel, handleAdminLogout, showToast]);

    const resetLogoutTimer = useCallback(() => {
        if (isAdminLoggedIn && showAdminPanel) {
            startLogoutTimer();
        }
    }, [isAdminLoggedIn, showAdminPanel, startLogoutTimer]);

    useEffect(() => {
        if (isAdminLoggedIn && showAdminPanel) {
            startLogoutTimer();
            const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
            events.forEach(event => window.addEventListener(event, resetLogoutTimer));
            return () => {
                events.forEach(event => window.removeEventListener(event, resetLogoutTimer));
                if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
            };
        }
    }, [isAdminLoggedIn, showAdminPanel, startLogoutTimer, resetLogoutTimer]);

    useEffect(() => {
        const handleSessionExpired = () => {
            if (isAdminLoggedIn) {
                showToast('Your admin session has expired. Please log in again.', 'error');
                handleAdminLogout();
                setShowAdminPanel(false);
            }
        };
        window.addEventListener('admin-session-expired', handleSessionExpired);
        return () => window.removeEventListener('admin-session-expired', handleSessionExpired);
    }, [isAdminLoggedIn, handleAdminLogout, showToast]);

    // ---------- End of auto-logout code ----------

    const handleUpdateTeacher = useCallback(async (id: number, data: { name: string; department: string; image_url?: string }) => {
        try {
            await updateTeacher(id, data);
            showToast('Teacher updated successfully!', 'success');
            loadTeachers(1);
            await loadAdminData();
        } catch (error) {
            console.error('Update error:', error);
            showToast('Failed to update teacher', 'error');
        }
    }, [loadTeachers, loadAdminData, showToast]);

    const handleAddTeacher = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeacherName || !newTeacherDepartment) {
            showToast('Please fill in all fields', 'error');
            return;
        }
        try {
            await addTeacher({
                name: newTeacherName,
                department: newTeacherDepartment,
                image_url: newTeacherImage || undefined
            });
            showToast('Teacher added successfully!', 'success');
            setNewTeacherName('');
            setNewTeacherDepartment('');
            setNewTeacherImage('');
            setShowAddTeacherForm(false);
            loadTeachers(1);
            await loadAdminData();
        } catch (error) {
            showToast('Failed to add teacher', 'error');
        }
    }, [newTeacherName, newTeacherDepartment, newTeacherImage, loadTeachers, loadAdminData, showToast]);

    const handleDeleteTeacher = useCallback(async (id: number) => {
        if (window.confirm('Are you sure you want to delete this teacher? All reviews will also be deleted.')) {
            try {
                await deleteTeacher(id);
                showToast('Teacher deleted successfully!', 'success');
                loadTeachers(1);
                if (selectedTeacher?.id === id) {
                    setSelectedTeacher(null);
                    setShowReviewForm(false);
                }
                await loadAdminData();
            } catch (error) {
                showToast('Failed to delete teacher', 'error');
            }
        }
    }, [selectedTeacher, loadTeachers, loadAdminData, showToast]);

    const handleDeleteReview = useCallback(async (id: number) => {
        if (window.confirm('Are you sure you want to delete this review?')) {
            try {
                await deleteReview(id);
                showToast('Review deleted successfully!', 'success');
                await loadAdminData();
                if (selectedTeacher) {
                    const response = await getTeacherDetail(selectedTeacher.id);
                    const data = response.data;
                    setSelectedTeacher({
                        id: data.id || selectedTeacher.id,
                        name: data.name || data.teacher?.name || selectedTeacher.name,
                        department: data.department || data.teacher?.department || selectedTeacher.department,
                        review_count: data.review_count || data.total_reviews || 0,
                        total_reviews: data.total_reviews || 0,
                        image_url: data.image_url || data.teacher?.image_url || null,
                        reviews: data.reviews || [],
                    });
                }
            } catch (error) {
                showToast('Failed to delete review', 'error');
            }
        }
    }, [selectedTeacher, loadAdminData, showToast]);

    const handleDeleteQuestion = useCallback(async (id: number) => {
        if (window.confirm('Are you sure you want to delete this question and all its answers?')) {
            try {
                await deleteQuestion(id);
                showToast('Question deleted successfully!', 'success');
                await loadAdminData();
                if (selectedTeacher) {
                    const response = await getTeacherDetail(selectedTeacher.id);
                    const data = response.data;
                    setSelectedTeacher({
                        id: data.id || selectedTeacher.id,
                        name: data.name || data.teacher?.name || selectedTeacher.name,
                        department: data.department || data.teacher?.department || selectedTeacher.department,
                        review_count: data.review_count || data.total_reviews || 0,
                        total_reviews: data.total_reviews || 0,
                        image_url: data.image_url || data.teacher?.image_url || null,
                        reviews: data.reviews || [],
                    });
                }
            } catch (error) {
                showToast('Failed to delete question', 'error');
            }
        }
    }, [selectedTeacher, loadAdminData, showToast]);

    const handleSubmitReview = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTeacher) {
            setReviewError('No teacher selected');
            return;
        }
        if (!reviewComment.trim()) {
            setReviewError('Please write a review');
            return;
        }
        setSubmitting(true);
        setReviewError('');
        try {
            await submitReview({
                teacher_id: selectedTeacher.id,
                comment: reviewComment.trim(),
                user_name: reviewUserName.trim() || 'Anonymous'
            });
            showToast('Review submitted successfully!', 'success');
            haptic([12, 40, 12]);
            // Confetti
            if ((window as any).canvasConfetti) {
                (window as any).canvasConfetti({
                    particleCount: 100,
                    spread: 70,
                    origin: { y: 0.6 },
                    colors: ['#667eea', '#764ba2', '#fbbf24']
                });
            }
            setShowReviewForm(false);
            setReviewComment('');
            setReviewUserName('');
            setReviewError('');
            setReviewSuccess(`Your review for ${selectedTeacher.name} has been submitted. Thank you!`);

            const response = await getTeacherDetail(selectedTeacher.id);
            const data = response.data;
            setSelectedTeacher({
                id: data.id || selectedTeacher.id,
                name: data.name || data.teacher?.name || selectedTeacher.name,
                department: data.department || data.teacher?.department || selectedTeacher.department,
                review_count: data.review_count || data.total_reviews || 0,
                total_reviews: data.total_reviews || 0,
                image_url: data.image_url || data.teacher?.image_url || null,
                reviews: data.reviews || [],
            });
            await loadTeachers(1);
            await loadAdminData();
        } catch (err: any) {
            console.error('Submit error:', err);
            setReviewError(err.response?.data?.error || 'Failed to submit review');
        } finally {
            setSubmitting(false);
        }
    }, [selectedTeacher, reviewComment, reviewUserName, loadTeachers, loadAdminData, showToast]);

    const handleTeacherClick = useCallback(async (teacher: Teacher) => {
        try {
            const response = await getTeacherDetail(teacher.id);
            const data = response.data;
            const teacherInfo = data.teacher;
            const reviewsList = data.reviews || [];
            const totalReviews = data.total_reviews || 0;

            const teacherData: TeacherDetail = {
                id: teacherInfo.id,
                name: teacherInfo.name,
                department: teacherInfo.department,
                review_count: totalReviews,
                total_reviews: totalReviews,
                image_url: teacherInfo.image_url || null,
                reviews: reviewsList,
            };
            setSelectedTeacher(teacherData);
            setShowReviewForm(false);
            setReviewComment('');
            setReviewUserName('');
            setReviewError('');
            setReviewSuccess('');

            // Auto-scroll on mobile
            if (window.innerWidth <= 768 && mainContentRef.current) {
                listScrollPosRef.current = window.scrollY;
                setTimeout(() => {
                    mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }

            navigate(`/teacher/${teacher.id}`);
        } catch (error) {
            console.error('Error loading teacher details:', error);
            showToast('Failed to load teacher details', 'error');
        }
    }, [navigate, showToast]);

    const restoreListScroll = useCallback(() => {
        if (window.innerWidth > 768) return;
        const pos = listScrollPosRef.current;
        setTimeout(() => {
            window.scrollTo({ top: pos, behavior: 'auto' });
        }, 60);
    }, []);

    const clearSelectedTeacher = () => {
        setSelectedTeacher(null);
        setShowReviewForm(false);
        setReviewSuccess('');
        navigate('/');
        restoreListScroll();
    };

    // Clear the selected teacher when leaving the /teacher/:id view (e.g. browser back)
    useEffect(() => {
        if (!teacherIdParam && selectedTeacher && !isComparing) {
            setSelectedTeacher(null);
            setShowReviewForm(false);
            setReviewSuccess('');
            restoreListScroll();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [teacherIdParam]);

    // ========== TEACHER COMPARISON ==========
    const toggleCompare = useCallback((teacher: Teacher) => {
        haptic(8);
        setCompareList(prev => {
            const exists = prev.some(t => t.id === teacher.id);
            if (exists) return prev.filter(t => t.id !== teacher.id);
            if (prev.length >= 3) {
                showToast('You can compare up to 3 teachers at once', 'info');
                return prev;
            }
            return [...prev, teacher];
        });
    }, [showToast]);

    const clearCompare = useCallback(() => {
        setCompareList([]);
        setCompareDetails([]);
        setIsComparing(false);
    }, []);

    const runCompare = useCallback(async () => {
        if (compareList.length < 2) {
            showToast('Select at least 2 teachers to compare', 'info');
            return;
        }
        setCompareLoading(true);
        try {
            const results = await Promise.all(compareList.map(t => getTeacherDetail(t.id)));
            const details: TeacherDetail[] = results.map((res, i) => {
                const data = res.data;
                const teacherInfo = data.teacher || data;
                const reviewsList = data.reviews || [];
                const totalReviews = data.total_reviews || 0;
                return {
                    id: teacherInfo.id,
                    name: teacherInfo.name,
                    department: teacherInfo.department,
                    review_count: totalReviews,
                    total_reviews: totalReviews,
                    image_url: teacherInfo.image_url || null,
                    reviews: reviewsList,
                };
            });
            setCompareDetails(details);
            setIsComparing(true);
            setSelectedTeacher(null);
            navigate('/');
            // Auto-scroll to compare view on mobile
            if (window.innerWidth <= 768 && mainContentRef.current) {
                listScrollPosRef.current = window.scrollY;
                setTimeout(() => {
                    mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 150);
            }
        } catch (error) {
            console.error('Error loading compare data:', error);
            showToast('Failed to load comparison data', 'error');
        } finally {
            setCompareLoading(false);
        }
    }, [compareList, navigate, showToast]);

    const displayTeachers = isSearching ? searchResults : teachers;

    const loadMore = useCallback(() => {
        if (!isSearching && hasMore && !loadingMore) {
            setCurrentPage(prev => prev + 1);
        }
    }, [isSearching, hasMore, loadingMore]);

    // ========== BOTTOM NAV (mobile) ==========
    const scrollListIntoView = useCallback(() => {
        if (window.innerWidth <= 768) {
            const sidebar = document.querySelector('.sidebar');
            sidebar?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, []);

    const handleTabHome = useCallback(() => {
        haptic(10);
        setShowMobileMenu(false);
        setSelectedTeacher(null);
        setIsComparing(false);
        setShowReviewForm(false);
        setReviewSuccess('');
        navigate('/');
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
    }, [navigate]);

    const handleTabSearch = useCallback(() => {
        haptic(10);
        setShowMobileMenu(false);
        setSelectedTeacher(null);
        setIsComparing(false);
        setShowReviewForm(false);
        navigate('/');
        setTimeout(() => {
            scrollListIntoView();
            searchInputRef.current?.focus();
        }, 140);
    }, [navigate, scrollListIntoView]);

    const handleTabCompare = useCallback(() => {
        haptic(10);
        setShowMobileMenu(false);
        if (isComparing) {
            setTimeout(() => mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
            return;
        }
        if (compareList.length >= 2) {
            runCompare();
        } else if (compareList.length === 1) {
            showToast('Add at least 1 more teacher to compare', 'info');
            scrollListIntoView();
        } else {
            showToast('Tap the + icon on any teacher card to add it', 'info');
            scrollListIntoView();
        }
    }, [isComparing, compareList.length, runCompare, showToast, scrollListIntoView]);

    const handleTabAdmin = useCallback(() => {
        haptic(10);
        setShowMobileMenu(false);
        setShowAdminPanel(true);
        if (isAdminLoggedIn) {
            loadAdminData();
            loadTeachers(1);
        }
    }, [isAdminLoggedIn, loadAdminData, loadTeachers]);

    // ========== RENDER ==========
    if (showAdminPanel) {
        if (!isAdminLoggedIn) {
            return (
                <div className="app">
                    <ParticleBackground />
                    <ToastHost toasts={toasts} />
                <header className={`header${headerScrolled ? ' header-scrolled' : ''}`}>
                        <h1>Teacher Review System - Admin</h1>
                        <button onClick={() => setShowAdminPanel(false)} className="back-to-site-btn">← Back to Site</button>
                    </header>
                    <div className="container">
                        <LoginForm
                            adminUsername={adminUsername}
                            setAdminUsername={setAdminUsername}
                            adminPassword={adminPassword}
                            setAdminPassword={setAdminPassword}
                            adminError={adminError}
                            onLogin={handleAdminLogin}
                        />
                    </div>
                </div>
            );
        }
        return (
            <div className="app">
                <ParticleBackground />
                <ToastHost toasts={toasts} />
                <header className="header">
                    <h1>Teacher Review System - Admin Panel</h1>
                    <button onClick={() => setShowAdminPanel(false)} className="back-to-site-btn">← Back to Site</button>
                </header>
                <div className="container">
                    <AdminPanel
                        teachers={teachers}
                        reviewsForModeration={reviewsForModeration}
                        onAddTeacher={handleAddTeacher}
                        onUpdateTeacher={handleUpdateTeacher}
                        onDeleteTeacher={handleDeleteTeacher}
                        onDeleteReview={handleDeleteReview}
                        onLogout={handleAdminLogout}
                        showAddTeacherForm={showAddTeacherForm}
                        setShowAddTeacherForm={setShowAddTeacherForm}
                        newTeacherName={newTeacherName}
                        setNewTeacherName={setNewTeacherName}
                        newTeacherDepartment={newTeacherDepartment}
                        setNewTeacherDepartment={setNewTeacherDepartment}
                        newTeacherImage={newTeacherImage}
                        setNewTeacherImage={setNewTeacherImage}
                        totalTeachersCount={totalTeachersCount}
                        loadingMore={loadingMore}
                        onLoadMore={() => setCurrentPage(prev => prev + 1)}
                        adminSearchTerm={adminSearchTerm}
                        onAdminSearchChange={handleAdminSearch}
                        adminSearchResults={adminSearchResults}
                        adminIsSearching={adminIsSearching}
                        onLoadMoreReviews={handleLoadMoreReviews}
                        adminLoadingMoreReviews={adminLoadingMoreReviews}
                        adminReviewsTotalPages={adminReviewsTotalPages}
                        adminReviewsPage={adminReviewsPage}
                        adminQuestions={adminQuestions}
                        onDeleteQuestion={handleDeleteQuestion}
                        adminLoadingMoreQuestions={adminLoadingMoreQuestions}
                        adminQuestionsPage={adminQuestionsPage}
                        adminQuestionsTotalPages={adminQuestionsTotalPages}
                        onLoadMoreQuestions={handleLoadMoreQuestions}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="app">
            <ParticleBackground />
            <ToastHost toasts={toasts} />
            {compareList.length === 0 && <InstallPrompt />}
            <PullToRefresh onRefresh={handlePullRefresh}>
                <header className="header">
                    <div className="header-top">
                        <div className="header-brand">
                            <img
                                src="https://www.umt.edu.pk/images/umt-logo.png"
                                alt="UMT Logo"
                                className="header-logo"
                            />
                            <h1 style={{ margin: 0 }}>UMT Teacher Reviews</h1>
                        </div>
                        <button
                            className={`menu-toggle${showMobileMenu ? ' menu-toggle-open' : ''}`}
                            onClick={() => setShowMobileMenu(v => !v)}
                            aria-expanded={showMobileMenu}
                            aria-label={showMobileMenu ? 'Close menu' : 'Open menu'}
                        >
                            {showMobileMenu ? <Icon name="x" size={22} /> : <Icon name="menu" size={22} />}
                        </button>
                    </div>
                    <p className="header-tagline">Read and write reviews about your professors anonymously</p>
                    <div className={`header-actions${showMobileMenu ? ' header-actions-open' : ''}`}>
                        <button onClick={() => {
                            setShowAdminPanel(true);
                            setShowMobileMenu(false);
                            if (isAdminLoggedIn) {
                                loadAdminData();
                                loadTeachers(1);
                            }
                        }} className="admin-login-btn">
                            <Icon name="lock" size={16} /> Admin Login
                        </button>
                        <button onClick={() => { setShowContactModal(true); setShowMobileMenu(false); }} className="admin-login-btn">
                            <Icon name="mail" size={16} /> Contact Us
                        </button>
                        <button onClick={() => { setShowAboutModal(true); setShowMobileMenu(false); }} className="admin-login-btn">
                            <Icon name="info" size={16} /> About
                        </button>
                    </div>
                </header>

                <div className="container">
                <div className="sidebar">
                    <div className="search-box">
                        <TeacherAutocomplete
                            value={searchTerm}
                            onInputChange={handleSearch}
                            inputRef={searchInputRef}
                            onSelect={(teacher) => {
                                setSearchTerm('');
                                setIsSearching(false);
                                setSearchResults([]);
                                setSearchParams((prev) => {
                                    const next = new URLSearchParams(prev);
                                    next.delete('search');
                                    return next;
                                });
                                handleTeacherClick(teacher);
                            }}
                            onClear={() => handleSearch({ target: { value: '' } } as React.ChangeEvent<HTMLInputElement>)}
                        />
                        {isSearching && searchTerm && (
                            <div className="search-info">
                                Found {searchResults.length} teacher{searchResults.length !== 1 ? 's' : ''} matching "{searchTerm}"
                            </div>
                        )}
                    </div>

                    {!isSearching && (
                        <div className="filter-bar">
                            <select
                                className="filter-select"
                                aria-label="Sort teachers"
                                value={sortBy}
                                onChange={(e) => { setSortBy(e.target.value); }}
                            >
                                <option value="name">Sort: Name</option>
                                <option value="reviews">Sort: Most Reviews</option>
                                <option value="newest">Sort: Newest</option>
                            </select>
                            <select
                                className="filter-select"
                                aria-label="Filter by department"
                                value={departmentFilter}
                                onChange={(e) => { setDepartmentFilter(e.target.value); }}
                            >
                                <option value="">All Departments</option>
                                {departments.map((d) => (
                                    <option key={d.department} value={d.department}>
                                        {d.department} ({d.teacher_count})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div className="teacher-list">
                        {loading ? (
                            <>
                                {[...Array(5)].map((_, i) => (
                                    <div key={i} className="skeleton-card">
                                        <div className="skeleton-image"></div>
                                        <div className="skeleton-text">
                                            <div className="skeleton-text-line"></div>
                                            <div className="skeleton-text-line"></div>
                                        </div>
                                    </div>
                                ))}
                            </>
                        ) : error ? (
                            <div className="error-message">
                                {error} <button onClick={() => loadTeachers(1)}>Retry</button>
                            </div>
                        ) : displayTeachers.length === 0 ? (
                            <div className="no-results">No teachers found</div>
                        ) : (
                            <>
                                {displayTeachers.map((teacher: Teacher, index: number) => (
                                    <div
                                        key={teacher.id}
                                        className="teacher-card-enter"
                                        style={{ animationDelay: `${Math.min(index * 0.06, 0.6)}s` }}
                                    >
                                        <TiltCard
                                            className="teacher-card"
                                            onClick={() => handleTeacherClick(teacher)}
                                        >
                                            <Avatar name={teacher.name} imageUrl={teacher.image_url} className="teacher-card-image" />
                                            <div className="teacher-card-info">
                                                <h3>{teacher.name}</h3>
                                                <p className="department">{teacher.department}</p>
                                                <span className="reviews-count">({teacher.review_count} reviews)</span>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    toggleCompare(teacher);
                                                }}
                                                className={`compare-toggle-btn ${compareList.some(t => t.id === teacher.id) ? 'compare-toggle-btn-active' : ''}`}
                                                aria-label={`Compare ${teacher.name}`}
                                                title="Add to comparison"
                                            >
                                                <span className="compare-check">{compareList.some(t => t.id === teacher.id) ? '✓' : '+'}</span>
                                            </button>
                                        </TiltCard>
                                    </div>
                                ))}
                                {loadingMore && <div className="loading-more">Loading more teachers...</div>}
                                {!isSearching && hasMore && !loadingMore && (
                                    <div className="load-more-container">
                                        <button onClick={loadMore} className="load-more-btn">
                                            Load More ({teachers.length} / {totalTeachersCount})
                                        </button>
                                    </div>
                                )}
                                {!isSearching && !hasMore && teachers.length > 0 && (
                            <div className="end-of-list">You've seen all {totalTeachersCount} teachers</div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="main-content" ref={mainContentRef}>
                    {isComparing && compareDetails.length > 0 ? (
                        <div className="compare-view">
                            <div className="compare-view-header">
                                <button onClick={() => { setIsComparing(false); restoreListScroll(); }} className="back-button">
                                    ← Back to list
                                </button>
                                <h1 className="gradient-text compare-title"><Icon name="compare" size={26} /> Compare Teachers</h1>
                            </div>

                            <div className="compare-grid">
                                {compareDetails.map((t) => (
                                    <div key={t.id} className="compare-card">
                                        <Avatar name={t.name} imageUrl={t.image_url} className="compare-card-image" />
                                        <h2 className="compare-card-name">{t.name}</h2>
                                        <p className="compare-card-dept">{t.department}</p>
                                        <span className="compare-card-count">{t.review_count} reviews</span>

                                        <div className="compare-card-reviews">
                                            <h3><Icon name="book-open" size={16} /> Reviews</h3>
                                            {!t.reviews || t.reviews.length === 0 ? (
                                                <p className="compare-no-reviews">No reviews yet.</p>
                                            ) : (
                                                t.reviews.slice(0, 2).map((review) => (
                                                    <div key={review.id} className="compare-review">
                                                        <p className="compare-review-text">"{review.comment}"</p>
                                                        <span className="compare-review-author">— {review.user_name || 'Anonymous'}</span>
                                                    </div>
                                                ))
                                            )}
                                            {t.reviews && t.reviews.length > 2 && (
                                                <p className="compare-more-reviews">+{t.reviews.length - 2} more review{t.reviews.length - 2 !== 1 ? 's' : ''}</p>
                                            )}
                                        </div>

                                        <button
                                            onClick={() => {
                                                setIsComparing(false);
                                                handleTeacherClick({ ...t } as Teacher);
                                            }}
                                            className="compare-view-btn"
                                        >
                                            View Full Profile →
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {compareDetails.length < 3 && (
                                <p className="compare-hint">Tip: add up to 3 teachers with the "+" button on any card.</p>
                            )}
                            <p className="compare-swipe-hint">← Swipe sideways to compare →</p>
                        </div>
                    ) : selectedTeacher ? (
                        <div className="teacher-detail">
                            <button onClick={clearSelectedTeacher} className="back-button">
                                ← Back to list
                            </button>

                            <Avatar name={selectedTeacher.name || 'Teacher'} imageUrl={selectedTeacher.image_url} className="teacher-detail-image" />

                            <h1 className="teacher-name-heading gradient-text">{selectedTeacher.name || 'Teacher'}</h1>
                            <p className="teacher-department">
                                <Link to={`/department/${encodeURIComponent(selectedTeacher.department || '')}`} className="department-link">
                                    {selectedTeacher.department || ''}
                                </Link>
                            </p>

                            <button
                                onClick={() => {
                                    const url = window.location.href;
                                    if (navigator.share) {
                                        navigator.share({ title: `${selectedTeacher.name} - UMT Teacher Reviews`, url }).catch(() => {});
                                    } else {
                                        navigator.clipboard.writeText(url).then(() => showToast('Link copied to clipboard!', 'success')).catch(() => {});
                                    }
                                }}
                                className="share-btn"
                                aria-label={`Share ${selectedTeacher.name}`}
                            >
                                <Icon name="share" size={16} /> Share
                            </button>

                            {reviewSuccess && (
                                <div className="success-message" role="status">
                                    {reviewSuccess}
                                </div>
                            )}

                            <button onClick={() => { if (selectedTeacher && selectedTeacher.id) setShowReviewForm(true); else setReviewError('Please select a teacher first'); }} className="btn-write-review">
                                <Icon name="edit" size={18} /> Write a Review for {selectedTeacher.name}
                            </button>

                            <LazySection
                                className="reviews-section"
                                placeholder={<div className="reviews-section" style={{ minHeight: '80px' }} />}
                            >
                                <h3><Icon name="book-open" size={20} /> Student Reviews</h3>
                                {!selectedTeacher.reviews || selectedTeacher.reviews.length === 0 ? (
                                    <EmptyState
                                        icon="book-open"
                                        title="No reviews yet"
                                        message="Be the first to review this teacher!"
                                        action={
                                            <button onClick={() => { if (selectedTeacher && selectedTeacher.id) setShowReviewForm(true); }} className="btn-write-review">
                                                <Icon name="edit" size={16} /> Write a Review
                                            </button>
                                        }
                                    />
                                ) : (
                                    selectedTeacher.reviews.map((review: Review) => (
                                        <div key={review.id} className="review-card">
                                            <div className="review-header">
                                                <span className="reviewer-name"><Icon name="user" size={13} /> {review.user_name || 'Anonymous'}</span>
                                                <span className="review-date"><Icon name="calendar" size={13} /> {new Date(review.created_at).toLocaleDateString()}</span>
                                            </div>
                                            <p className="review-comment">"{review.comment}"</p>
                                        </div>
                                    ))
                                )}
                            </LazySection>

                            <LazySection
                                className="qa-section-lazy"
                                placeholder={<div className="qa-section" style={{ minHeight: '60px' }} />}
                            >
                                <QASection teacherId={selectedTeacher.id} teacherName={selectedTeacher.name || 'this teacher'} />
                            </LazySection>

                            {relatedTeachers.length > 0 && (
                                <div className="related-teachers">
                                    <h3><Icon name="users" size={18} /> More teachers in {selectedTeacher.department}</h3>
                                    <div className="related-teachers-list">
                                        {relatedTeachers.map((t) => (
                                            <button key={t.id} onClick={() => handleTeacherClick(t)} className="related-teacher-card">
                                                <span className="related-teacher-name">{t.name}</span>
                                                <span className="related-teacher-count">({t.review_count} reviews)</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="welcome-message">
                            <h2 className="gradient-text">Welcome to Teacher Reviews</h2>
                            <p className="welcome-hint-desktop">Select a teacher from the left to read reviews or submit your own.</p>
                            <p className="welcome-hint-mobile">Select a teacher from the list above to read reviews or submit your own.</p>
                            {departments.length > 0 && (
                                <div className="department-links">
                                    <h3>Browse by Department</h3>
                                    <div className="department-links-list">
                                        {departments.map((d) => (
                                            <Link key={d.department} to={`/department/${encodeURIComponent(d.department)}`} className="department-link-chip">
                                                {d.department}
                                            </Link>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>

            <footer className="app-footer">
                <div className="footer-content">
                    <p>© {new Date().getFullYear()} UMT Teacher Reviews. All rights reserved.</p>
                    <p>Developed by Munawar Hussain</p>
                    <p className="footer-links">
                        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a> · <a href="/dmca">DMCA &amp; Content Removal</a>
                    </p>
                    <p className="footer-disclaimer">All reviews are student opinions and not official university statements.</p>
                </div>
            </footer>
            </PullToRefresh>
            {showAboutModal && (
                <div className="modal-overlay" onClick={() => setShowAboutModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3 className="gradient-text modal-heading"><Icon name="book-open" size={22} /> About UMT Teacher Reviews</h3>
                        <p>This platform allows students to write and read reviews about their teachers anonymously.</p>
                        <hr />
                        <p><strong>Developer:</strong> Munawar Hussain</p>
                        <p><strong>Supporters &amp; Contributors:</strong></p>
                        <ul style={{ textAlign: 'left', display: 'inline-block', margin: '0 auto', paddingLeft: '1.5rem' }}>
                            <li>Ahtasham Bilal</li>
                            <li>Amjad Ali Awan</li>
                            <li>Muhammad Anas</li>
                            <li>Muhamad Ahmad</li>
                            <li>Muhammad Dawood</li>
                            <li>Umair Hassan</li>
                            <li>Muhammad Khaleel</li>
                            <li>Farhan Sarwar</li>
                        </ul>
                        <p><strong>Version:</strong> 2.0</p>
                        <button onClick={() => setShowAboutModal(false)} className="modal-close-btn">Close</button>
                    </div>
                </div>
            )}
            {showContactModal && (
                <div className="modal-overlay" onClick={() => setShowContactModal(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <h3 className="gradient-text modal-heading"><Icon name="mail" size={22} /> Contact Us</h3>
                        <p>If you have any questions, need help, or want to give feedback, please send an email to:</p>
                        <p><strong>umt.teacher.reviews@gmail.com</strong></p>
                        <button onClick={() => setShowContactModal(false)} className="modal-close-btn">Close</button>
                    </div>
                </div>
            )}
            {showReviewForm && selectedTeacher && (
                <div className="modal-overlay" onClick={() => setShowReviewForm(false)}>
                    <div className="modal-content review-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Write a review for ${selectedTeacher.name}`}>
                        <h3 className="review-form-title">
                            <Icon name="edit" size={20} /> Write a Review for {selectedTeacher.name}
                        </h3>
                        {reviewError && <div className="error-message">{reviewError}</div>}
                        <form onSubmit={handleSubmitReview}>
                            <div className="form-group">
                                <label>Your Name (optional)</label>
                                <input type="text" value={reviewUserName} onChange={(e) => setReviewUserName(e.target.value)} placeholder="Leave blank to post anonymously" aria-label="Your name (optional)" />
                            </div>
                            <div className="form-group">
                                <label>Your Review *</label>
                                <textarea rows={4} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="Share your experience with this teacher..." required aria-label="Your review" />
                            </div>
                            <div className="form-buttons">
                                <button type="button" onClick={() => setShowReviewForm(false)} className="btn-cancel">Cancel</button>
                                <button type="submit" disabled={submitting} className="btn-submit">
                                    {submitting ? <><span className="spinner-small"></span> Submitting...</> : 'Submit Review'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
            {compareList.length > 0 && !isComparing && (
                <div className="compare-bar">
                    <div className="compare-bar-info">
                        <span className="compare-bar-count">{compareList.length}/3 selected</span>
                        <div className="compare-bar-names">
                            {compareList.map((t) => (
                                <span key={t.id} className="compare-bar-name" onClick={() => toggleCompare(t)} title="Remove">
                                    {t.name} ✕
                                </span>
                            ))}
                        </div>
                    </div>
                    <div className="compare-bar-actions">
                        <button onClick={clearCompare} className="compare-clear-btn">Clear</button>
                        <button onClick={runCompare} disabled={compareList.length < 2 || compareLoading} className="compare-go-btn">
                            {compareLoading ? <><span className="spinner-small"></span> Loading...</> : 'Compare'}
                        </button>
                    </div>
                </div>
            )}
            <BottomNav
                items={[
                    { key: 'home', label: 'Home', icon: 'home', active: !isComparing, onClick: handleTabHome },
                    { key: 'search', label: 'Search', icon: 'search', active: isSearching && !!searchTerm, onClick: handleTabSearch },
                    { key: 'compare', label: 'Compare', icon: 'compare', active: isComparing, onClick: handleTabCompare },
                    { key: 'admin', label: 'Admin', icon: 'lock', onClick: handleTabAdmin },
                ]}
            />
        </div>
    );
};

export default App;
