import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams, useParams, useNavigate, useLocation, Link } from 'react-router-dom';
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
    updateReview,
    approveReview,
    rejectReview,
    getAdminReviews,
    getAdminQuestions,
    getAdminStats,
    deleteQuestion,
    updateQuestion,
    updateAnswer,
    deleteAnswer,
    bulkReviewDecision,
    submitReview,
    getAdminCustomCourses,
    reviewCustomCourse,
    getAdminTeacherDetail,
    cleanTeacherImages,
    getAdminReports,
    updateReportStatus
} from './services/api';
import { debounce } from './utils/debounce';
import { SITE_URL } from './utils/siteUrl';
import { applySeo } from './utils/seo';
import TiltCard from './components/TiltCard';
import TeacherAutocomplete from './components/TeacherAutocomplete';
import InstallPrompt from './components/InstallPrompt';
import PullToRefresh from './components/PullToRefresh';
import Icon from './components/Icon';
import Avatar from './components/Avatar';
import BottomNav from './components/BottomNav';
import AdminPanel from './components/AdminPanel';
import LoginForm from './components/LoginForm';
import CompareView from './components/CompareView';
import TeacherDetailView from './components/TeacherDetailView';
import ReviewFormModal from './components/ReviewFormModal';
import QuestionsView from './components/QuestionsView';
import ErrorBoundary from './components/ErrorBoundary';
import { TeacherCardSkeleton } from './components/Skeleton';
import { ToastHost } from './components/Toast';
import { haptic } from './utils/haptics';
import type { Teacher, TeacherDetail, Review, AdminReview, AdminQuestion, CustomCourse, AdminTeacherDetail, AdminReport, AdminStats, Toast } from './types';
import './App.css';

// ========== HELPER: Map API response to TeacherDetail ==========
interface TeacherDetailResponse {
    teacher?: Teacher;
    reviews?: Review[];
    total_reviews?: number;
    review_pagination?: TeacherDetail['review_pagination'];
}

const mapTeacherDetail = (data: TeacherDetailResponse, fallback?: TeacherDetail): TeacherDetail => {
    const teacherInfo: Teacher = data.teacher || fallback || (data as unknown as Teacher);
    const reviewsList = data.reviews || [];
    const totalReviews = data.total_reviews || 0;
    return {
        id: teacherInfo.id,
        name: teacherInfo.name,
        department: teacherInfo.department,
        review_count: totalReviews,
        total_reviews: totalReviews,
        image_url: teacherInfo.image_url || undefined,
        reviews: reviewsList,
        review_pagination: data.review_pagination,
    };
};

// ========== MAIN APP ==========
const App: React.FC = () => {
    const [searchParams, setSearchParams] = useSearchParams();
    const { id: teacherIdParam } = useParams();
    const navigate = useNavigate();
    const location = useLocation();

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
    const [reviewsLoadingMore, setReviewsLoadingMore] = useState(false);
    const [relatedTeachers, setRelatedTeachers] = useState<Teacher[]>([]);
    const [compareList, setCompareList] = useState<Teacher[]>([]);
    const [isComparing, setIsComparing] = useState(false);
    const [isMobileViewport, setIsMobileViewport] = useState(() => window.innerWidth <= 768);
    const [compareDetails, setCompareDetails] = useState<TeacherDetail[]>([]);
    const [compareLoading, setCompareLoading] = useState(false);
    const [compareSearchTerm, setCompareSearchTerm] = useState('');
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [reviewComment, setReviewComment] = useState('');
    const [reviewUserName, setReviewUserName] = useState('');
    const [reviewCourses, setReviewCourses] = useState<string[]>([]);
    const [submitting, setSubmitting] = useState(false);
    const [reviewError, setReviewError] = useState('');
    const [reviewSuccess, setReviewSuccess] = useState('');

    const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
    const [adminAuthChecked, setAdminAuthChecked] = useState(false);
    const [adminMutationLoading, setAdminMutationLoading] = useState(false);
    // Keep the admin panel open across a refresh by backing it with /admin.
    const [showAdminPanel, setShowAdminPanel] = useState(() => location.pathname === '/admin');
    const [adminUsername, setAdminUsername] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [adminError, setAdminError] = useState('');
    const [admin_totp_code, setAdmin_totp_code] = useState('');
    /** When true, login was accepted but a TOTP code is still required. */
    const [requires_totp, setRequires_totp] = useState(false);
    const [showAddTeacherForm, setShowAddTeacherForm] = useState(false);
    const [newTeacherName, setNewTeacherName] = useState('');
    const [newTeacherDepartment, setNewTeacherDepartment] = useState('');
    const [newTeacherImage, setNewTeacherImage] = useState('');
    const [reviewsForModeration, setReviewsForModeration] = useState<AdminReview[]>([]);
    const [adminStats, setAdminStats] = useState<AdminStats | null>(null);
    const [adminTotpEnabled, setAdminTotpEnabled] = useState(false);

    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastIdRef = useRef(0);

    const mainContentRef = useRef<HTMLDivElement>(null);
    const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const listScrollPosRef = useRef(0);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const compareSearchInputRef = useRef<HTMLInputElement>(null);
    // Where "Back to Site" should return after visiting /admin.
    const adminReturnPathRef = useRef('/');

    const [showAboutModal, setShowAboutModal] = useState(false);
    const [showContactModal, setShowContactModal] = useState(false);
    const [showMobileMenu, setShowMobileMenu] = useState(false);
    const [headerScrolled, setHeaderScrolled] = useState(false);
    // Site-wide Q&A board (also keeps /questions working on a hard refresh)
    const [showQnA, setShowQnA] = useState(() => typeof window !== 'undefined' && window.location.pathname === '/questions');

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

    // /admin is a real URL so a refresh stays in the admin panel. Remember the
    // page we came from so "Back to Site" returns there instead of always home.
    const openAdminPanel = useCallback(() => {
        if (location.pathname !== '/admin') {
            adminReturnPathRef.current = `${location.pathname}${location.search}`;
        }
        setShowAdminPanel(true);
        navigate('/admin');
    }, [location.pathname, location.search, navigate]);

    const closeAdminPanel = useCallback(() => {
        setShowAdminPanel(false);
        navigate(adminReturnPathRef.current || '/');
    }, [navigate]);

    // Keep the panel in sync with the URL (browser back/forward, direct links).
    useEffect(() => {
        setShowAdminPanel(location.pathname === '/admin');
    }, [location.pathname]);

    // ========== TOASTS ==========
    const showToast = useCallback((message: string, type: Toast['type'] = 'info') => {
        const id = ++toastIdRef.current;
        setToasts(prev => [...prev, { id, message, type }]);
    }, []);

    const dismissToast = useCallback((id: number) => {
        setToasts(prev => prev.filter(t => t.id !== id));
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
        } catch (err) {
            console.error('Failed to load teachers:', err);
            const axiosErr = err as { code?: string; message?: string };
            if (retryCount === 0 && (axiosErr.code === 'ECONNABORTED' || axiosErr.message?.includes('timeout'))) {
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

    // Load departments for the filter dropdown (and the admin department picker).
    // Re-run after any teacher add/edit/delete so new departments show up site-wide.
    const loadDepartments = useCallback(() => {
        getDepartments().then((res) => {
            if (res.data && Array.isArray(res.data)) setDepartments(res.data);
        }).catch(() => { /* ignore */ });
    }, []);

    useEffect(() => {
        loadDepartments();
    }, [loadDepartments]);

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
            const res = await searchAllTeachers(value, 50);
            setSearchResults(res.data || []);
        } catch (searchErr) {
            console.error('Search error:', searchErr);
            setSearchResults([]);
        } finally {
            setLoading(false);
        }
    }, []);

    const handleSearch = useCallback((value: string) => {
        setSearchTerm(value);

        // The autocomplete reports the settled query (not every keystroke), so
        // the URL only updates once typing pauses. `replace` keeps the browser
        // history clean instead of adding one entry per character.
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            if (value) {
                next.set('search', value);
            } else {
                next.delete('search');
            }
            return next;
        }, { replace: true });

        // Do NOT replace the sidebar list while typing – the autocomplete
        // dropdown handles suggestions. Only reload the full list on clear.
        if (!value.trim()) {
            setIsSearching(false);
            setSearchResults([]);
            setCurrentPage(1);
            loadTeachers(1);
        } else {
            // Leaving a shared/deep-linked result list? Typing now drives the
            // dropdown, so show the regular sidebar list again.
            setIsSearching(false);
            setSearchResults([]);
        }
    }, [setSearchParams, loadTeachers]);

    const debouncedAdminSearch = useRef(debounce(async (value: string) => {
        if (value.trim()) {
            setAdminIsSearching(true);
            try {
                const res = await searchAllTeachers(value, 50);
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
    }, 300));

    const handleAdminSearch = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setAdminSearchTerm(value);
        debouncedAdminSearch.current(value);
    }, []);

    // ========== ADMIN DATA ==========
    const [adminReviewsPage, setAdminReviewsPage] = useState(1);
    const [adminReviewsTotalPages, setAdminReviewsTotalPages] = useState(1);
    const [adminLoadingMoreReviews, setAdminLoadingMoreReviews] = useState(false);
    const [adminQuestions, setAdminQuestions] = useState<AdminQuestion[]>([]);
    const [adminQuestionsPage, setAdminQuestionsPage] = useState(1);
    const [adminQuestionsTotalPages, setAdminQuestionsTotalPages] = useState(1);
    const [adminLoadingMoreQuestions, setAdminLoadingMoreQuestions] = useState(false);
    const [customCourses, setCustomCourses] = useState<CustomCourse[]>([]);
    // When true, the admin reviews list fetches only pending (unapproved) rows.
    const [reviewsPendingOnly, setReviewsPendingOnly] = useState(false);

    // Reader reports (Reports tab)
    const [adminReports, setAdminReports] = useState<AdminReport[]>([]);
    const [adminReportsPage, setAdminReportsPage] = useState(1);
    const [adminReportsTotalPages, setAdminReportsTotalPages] = useState(1);
    const [adminLoadingMoreReports, setAdminLoadingMoreReports] = useState(false);
    const [adminReportsStatus, setAdminReportsStatus] = useState<'open' | 'resolved' | 'dismissed'>('open');

    // Mirror the loaded-page counters into refs so loadAdminData can reload
    // every page the admin has open without re-creating the callback itself.
    const adminReviewsPageRef = useRef(adminReviewsPage);
    const adminQuestionsPageRef = useRef(adminQuestionsPage);
    const adminReportsPageRef = useRef(adminReportsPage);
    // Read inside loadAdminData without making it a dependency: the status
    // switch already fetches page 1, and an identity change here would make
    // the login effect fire a second, redundant round of requests.
    const adminReportsStatusRef = useRef(adminReportsStatus);
    useEffect(() => { adminReviewsPageRef.current = adminReviewsPage; }, [adminReviewsPage]);
    useEffect(() => { adminQuestionsPageRef.current = adminQuestionsPage; }, [adminQuestionsPage]);
    useEffect(() => { adminReportsPageRef.current = adminReportsPage; }, [adminReportsPage]);
    useEffect(() => { adminReportsStatusRef.current = adminReportsStatus; }, [adminReportsStatus]);

    const loadAdminData = useCallback(async () => {
        // Re-fetch every review/Q&A/report page the admin already has open, not
        // just page 1: resetting to a single page after a save collapsed the
        // list and yanked the viewport to the top of the page.
        const reviewPages = Array.from({ length: Math.max(adminReviewsPageRef.current, 1) }, (_, i) => i + 1);
        const questionPages = Array.from({ length: Math.max(adminQuestionsPageRef.current, 1) }, (_, i) => i + 1);
        const reportPages = Array.from({ length: Math.max(adminReportsPageRef.current, 1) }, (_, i) => i + 1);

        const [reviewsResult, questionsResult, coursesResult, reportsResult] = await Promise.allSettled([
            Promise.all(reviewPages.map((p) => getAdminReviews(p, 50, reviewsPendingOnly))),
            Promise.all(questionPages.map((p) => getAdminQuestions(p, 50))),
            getAdminCustomCourses(),
            Promise.all(reportPages.map((p) => getAdminReports(p, 50, adminReportsStatusRef.current)))
        ]);

        let reviewsData: AdminReview[] = [];
        let totalPages = 1;
        if (reviewsResult.status === 'fulfilled') {
            for (const reviewsRes of reviewsResult.value) {
                const d = reviewsRes.data;
                if (!d) continue;
                if (Array.isArray(d)) {
                    reviewsData = reviewsData.concat(d);
                } else if (d.reviews) {
                    reviewsData = reviewsData.concat(d.reviews);
                    totalPages = d.pagination?.totalPages || 1;
                } else if (d.data) {
                    reviewsData = reviewsData.concat(d.data);
                }
            }
        } else {
            console.error('Error loading admin reviews:', reviewsResult.reason);
        }

        let questionsData: AdminQuestion[] = [];
        let questionsTotalPages = 1;
        if (questionsResult.status === 'fulfilled') {
            for (const questionsRes of questionsResult.value) {
                const d = questionsRes.data;
                if (d?.questions) {
                    questionsData = questionsData.concat(d.questions);
                    questionsTotalPages = d.pagination?.totalPages || 1;
                }
            }
        } else {
            console.error('Error loading admin questions:', questionsResult.reason);
        }

        if (coursesResult.status === 'fulfilled') {
            setCustomCourses(coursesResult.value.data?.courses || []);
        } else {
            console.error('Error loading custom courses:', coursesResult.reason);
        }

        let reportsData: AdminReport[] = [];
        let reportsTotalPages = 1;
        if (reportsResult.status === 'fulfilled') {
            for (const reportsRes of reportsResult.value) {
                const d = reportsRes.data;
                if (!d) continue;
                reportsData = reportsData.concat(d.reports || []);
                reportsTotalPages = d.pagination?.totalPages || reportsTotalPages;
            }
        } else {
            console.error('Error loading review reports:', reportsResult.reason);
        }

        setAdminReviewsTotalPages(totalPages);
        setAdminQuestionsTotalPages(questionsTotalPages);
        setAdminReportsTotalPages(reportsTotalPages);
        setReviewsForModeration(reviewsData);
        setAdminQuestions(questionsData);
        setAdminReports(reportsData);
        // No page-counter reset here: every already-loaded page was re-fetched
        // above, so the list keeps its length and the viewport stays put.

        // Fetch actual totals from the stats endpoint
        try {
            const statsRes = await getAdminStats();
            setAdminStats(statsRes.data);
        } catch (err) {
            console.error('Error loading admin stats:', err);
        }

        // Check whether 2FA is enabled on this account (loaded with every
        // data refresh so the security tab can update instantly after a change).
        try {
            const meRes = await adminMe();
            const enabled = !!meRes.admin.totp_enabled;
            setAdminTotpEnabled(enabled);
        } catch (err) {
            console.error('Error checking 2FA status:', err);
        }
    }, [reviewsPendingOnly]);

    // Toggle the "pending only" review filter (dashboard pending counter).
    // Fetches page 1 with the *next* flag explicitly to avoid stale state.
    const handleTogglePendingOnly = useCallback(async () => {
        const next = !reviewsPendingOnly;
        setReviewsPendingOnly(next);
        try {
            const res = await getAdminReviews(1, 50, next);
            const data = res.data?.reviews || [];
            setReviewsForModeration(data);
            setAdminReviewsTotalPages(res.data?.pagination?.totalPages || 1);
            setAdminReviewsPage(1);
        } catch (error) {
            console.error('Error applying pending filter:', error);
            showToast('Failed to filter reviews', 'error');
        }
    }, [reviewsPendingOnly, showToast]);

    const handleLoadMoreReviews = useCallback(async () => {
        const nextPage = adminReviewsPage + 1;
        if (nextPage > adminReviewsTotalPages || adminLoadingMoreReviews) return;
        setAdminLoadingMoreReviews(true);
        try {
            const reviewsRes = await getAdminReviews(nextPage, 50, reviewsPendingOnly);
            const reviewsData = reviewsRes.data?.reviews || [];
            setReviewsForModeration(prev => [...prev, ...reviewsData]);
            setAdminReviewsPage(nextPage);
        } catch (error) {
            console.error('Error loading more reviews:', error);
            showToast('Failed to load more reviews', 'error');
        } finally {
            setAdminLoadingMoreReviews(false);
        }
    }, [adminReviewsPage, adminReviewsTotalPages, adminLoadingMoreReviews, reviewsPendingOnly, showToast]);

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

    const handleLoadMoreReports = useCallback(async () => {
        const nextPage = adminReportsPage + 1;
        if (nextPage > adminReportsTotalPages || adminLoadingMoreReports) return;
        setAdminLoadingMoreReports(true);
        try {
            const reportsRes = await getAdminReports(nextPage, 50, adminReportsStatus);
            const reportsData = reportsRes.data?.reports || [];
            setAdminReports(prev => [...prev, ...reportsData]);
            setAdminReportsPage(nextPage);
        } catch (error) {
            console.error('Error loading more reports:', error);
            showToast('Failed to load more reports', 'error');
        } finally {
            setAdminLoadingMoreReports(false);
        }
    }, [adminReportsPage, adminReportsTotalPages, adminLoadingMoreReports, adminReportsStatus, showToast]);

    const handleReportsStatusChange = useCallback(async (status: 'open' | 'resolved' | 'dismissed') => {
        setAdminReportsStatus(status);
        setAdminReportsPage(1);
        try {
            const res = await getAdminReports(1, 50, status);
            setAdminReports(res.data?.reports || []);
            setAdminReportsTotalPages(res.data?.pagination?.totalPages || 1);
        } catch (error) {
            console.error('Error filtering reports:', error);
            showToast('Failed to load reports', 'error');
        }
    }, [showToast]);

    const handleUpdateReportStatus = useCallback(async (id: number, status: 'open' | 'resolved' | 'dismissed') => {
        setAdminMutationLoading(true);
        try {
            await updateReportStatus(id, status);
            showToast(`Report marked ${status}`, 'success');
            // The row leaves the current filter, so refresh both the list and
            // the open-report badge rather than patching local state.
            await loadAdminData();
        } catch (error) {
            console.error('Error updating report:', error);
            showToast('Failed to update report', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [loadAdminData, showToast]);

    const handleReviewCustomCourse = useCallback(async (id: number, action: 'approve' | 'reject') => {
        try {
            await reviewCustomCourse(id, action);
            setCustomCourses(prev => prev.map((c): CustomCourse => c.id === id ? { ...c, status: (action === 'approve' ? 'approved' : 'rejected') as CustomCourse['status'], reviewed_at: new Date().toISOString() } : c));
            showToast(`Course ${action}d`, 'success');
        } catch (error) {
            console.error(`Error ${action}ing custom course:`, error);
            showToast(`Failed to ${action} course`, 'error');
        }
    }, [showToast]);

    const handleLoadTeacherDetail = useCallback(async (id: number): Promise<AdminTeacherDetail | null> => {
        try {
            const response = await getAdminTeacherDetail(id);
            return response.data as AdminTeacherDetail;
        } catch (error) {
            console.error('Error loading teacher detail for admin:', error);
            showToast('Failed to load teacher details', 'error');
            return null;
        }
    }, [showToast]);

    // Track mobile viewport for hiding the list when a detail page is open
    useEffect(() => {
        const onResize = () => setIsMobileViewport(window.innerWidth <= 768);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

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
                    setSelectedTeacher(mapTeacherDetail(response.data));
                } catch (err) {
                    console.error('Failed to restore teacher:', err);
                    // A wrong/removed teacher ID renders the normal list (an SPA
                    // cannot send a 404), so keep that soft-404 out of the index.
                    const status = (err as { response?: { status?: number } }).response?.status;
                    if (status === 404) {
                        const robots = document.head.querySelector('meta[name="robots"]');
                        if (robots) robots.setAttribute('content', 'noindex, nofollow');
                    }
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
                setSelectedTeacher(mapTeacherDetail(response.data));
            } catch (err) {
                console.error('Failed to restore teacher:', err);
                const status = (err as { response?: { status?: number } }).response?.status;
                if (status === 404) {
                    const robots = document.head.querySelector('meta[name="robots"]');
                    if (robots) robots.setAttribute('content', 'noindex, nofollow');
                }
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

    // Dynamic page title + Open Graph + Twitter + canonical + JSON-LD for SEO
    useEffect(() => {
        const baseUrl = SITE_URL;
        const path = location.pathname;
        let title = 'UMT Teacher Reviews – Anonymous Reviews for UMT Professors';
        let description = 'Read and write anonymous reviews for UMT teachers. Find the best professors at University of Management and Technology, Lahore.';
        let url = baseUrl + '/';
        let noindex = false;
        let jsonLd: Record<string, unknown> | null = null;

        if (selectedTeacher) {
            title = `${selectedTeacher.name} - ${selectedTeacher.department} | UMT Teacher Reviews`;
            description = `Read anonymous student reviews for ${selectedTeacher.name} (${selectedTeacher.department}) at UMT Lahore. See how ${selectedTeacher.review_count || 0} students rated their teaching experience.`;
            url = `${baseUrl}/teacher/${selectedTeacher.id}`;
            jsonLd = {
                '@context': 'https://schema.org',
                '@type': 'Person',
                'name': selectedTeacher.name,
                'jobTitle': 'Professor',
                'worksFor': {
                    '@type': 'EducationalOrganization',
                    'name': 'University of Management and Technology',
                    'address': { '@type': 'PostalAddress', 'addressLocality': 'Lahore', 'addressCountry': 'PK' }
                },
                'url': url,
                'description': description
            };
        } else if (path === '/questions') {
            title = 'Questions & Answers | UMT Teacher Reviews';
            description = 'Ask and answer questions about UMT teachers: grading, attendance, exams, and teaching style.';
            url = `${baseUrl}/questions`;
        } else if (path === '/admin') {
            // The login panel has nothing to rank for and must never appear in
            // search results next to teacher pages.
            title = 'Admin | UMT Teacher Reviews';
            description = 'Admin sign-in for UMT Teacher Reviews.';
            url = `${baseUrl}/admin`;
            noindex = true;
        } else if (searchTerm) {
            title = `Search "${searchTerm}" | UMT Teacher Reviews`;
            description = `Search results for "${searchTerm}" among UMT teachers. Read anonymous student reviews at UMT Teacher Reviews.`;
            url = `${baseUrl}/?search=${encodeURIComponent(searchTerm)}`;
        }

        applySeo({ title, description, url, noindex });

        // Inject / update JSON-LD for teacher pages
        let existingLd = document.getElementById('teacher-jsonld') as HTMLScriptElement | null;
        if (jsonLd) {
            if (!existingLd) {
                existingLd = document.createElement('script');
                existingLd.id = 'teacher-jsonld';
                existingLd.type = 'application/ld+json';
                document.head.appendChild(existingLd);
            }
            existingLd.textContent = JSON.stringify(jsonLd);
        } else if (existingLd) {
            existingLd.remove();
        }
    }, [selectedTeacher, searchTerm, location.pathname]);

    const checkAdminLogin = useCallback(async () => {
        try {
            await adminMe();
            setIsAdminLoggedIn(true);
        } catch {
            setIsAdminLoggedIn(false);
        } finally {
            setAdminAuthChecked(true);
        }
    }, []);

    const handleAdminLogin = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        setAdminError('');
        try {
            const res = await adminLogin(adminUsername, adminPassword, admin_totp_code || undefined);
            const data = res.data as any;
            if (data?.requires_totp) {
                setRequires_totp(true);
                return;
            }
            setIsAdminLoggedIn(true);
            setAdminUsername('');
            setAdminPassword('');
            setAdmin_totp_code('');
            setRequires_totp(false);
            showToast('Admin login successful!', 'success');
        } catch (error: any) {
            const errData = error?.response?.data;
            setAdminError(errData?.error || 'Login failed');
        }
    }, [adminUsername, adminPassword, admin_totp_code, showToast]);

    const logoutInFlightRef = useRef(false);

    const handleAdminLogout = useCallback(async () => {
        // Concurrent 401s used to fire several logouts, stacking toasts and
        // re-running the panel teardown.
        if (logoutInFlightRef.current) return;
        logoutInFlightRef.current = true;
        try {
            await adminLogout();
        } catch (error) {
            console.error('Logout error:', error);
        } finally {
            logoutInFlightRef.current = false;
        }
        setIsAdminLoggedIn(false);
        closeAdminPanel();
        setShowAddTeacherForm(false);
        if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
        showToast('Logged out successfully', 'info');
    }, [closeAdminPanel, showToast]);

    // ---------- Auto-logout timer (admin only) ----------
    const startLogoutTimer = useCallback(() => {
        if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = setTimeout(() => {
            if (isAdminLoggedIn && showAdminPanel) {
                console.log('Auto-logging out due to inactivity');
                handleAdminLogout();
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
            }
        };
        window.addEventListener('admin-session-expired', handleSessionExpired);
        return () => window.removeEventListener('admin-session-expired', handleSessionExpired);
    }, [isAdminLoggedIn, handleAdminLogout, showToast]);

    // ---------- End of auto-logout code ----------

    const handleUpdateTeacher = useCallback(async (id: number, data: { name: string; department: string; image_url?: string }) => {
        setAdminMutationLoading(true);
        try {
            await updateTeacher(id, data);
            showToast('Teacher updated successfully!', 'success');
            loadTeachers(1);
            loadDepartments();
            await loadAdminData();
        } catch (error) {
            console.error('Update error:', error);
            showToast('Failed to update teacher', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [loadTeachers, loadDepartments, loadAdminData, showToast]);

    const handleCleanTeacherImages = useCallback(async (dryRun: boolean) => {
        try {
            const res = await cleanTeacherImages(dryRun);
            if (!dryRun) {
                const cleaned = res.data?.cleaned ?? 0;
                showToast(`Cleared ${cleaned} broken photo URL${cleaned === 1 ? '' : 's'}`, 'success');
                loadTeachers(1);
            }
            return res.data || {};
        } catch (error) {
            console.error('Clean teacher images error:', error);
            showToast('Failed to check teacher photos', 'error');
            return {};
        }
    }, [loadTeachers, showToast]);

    const handleAddTeacher = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeacherName || !newTeacherDepartment) {
            showToast('Please fill in all fields', 'error');
            return;
        }
        setAdminMutationLoading(true);
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
            loadDepartments();
            await loadAdminData();
        } catch (error) {
            showToast('Failed to add teacher', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [newTeacherName, newTeacherDepartment, newTeacherImage, loadTeachers, loadDepartments, loadAdminData, showToast]);

    const handleDeleteTeacher = useCallback(async (id: number) => {
        if (window.confirm('Are you sure you want to delete this teacher? All reviews will also be deleted.')) {
            setAdminMutationLoading(true);
            try {
                await deleteTeacher(id);
                showToast('Teacher deleted successfully!', 'success');
                loadTeachers(1);
                loadDepartments();
                if (selectedTeacher?.id === id) {
                    setSelectedTeacher(null);
                    setShowReviewForm(false);
                }
                await loadAdminData();
            } catch (error) {
                showToast('Failed to delete teacher', 'error');
            } finally {
                setAdminMutationLoading(false);
            }
        }
    }, [selectedTeacher, loadTeachers, loadDepartments, loadAdminData, showToast]);

    const handleDeleteReview = useCallback(async (id: number) => {
        if (window.confirm('Are you sure you want to delete this review?')) {
            setAdminMutationLoading(true);
            try {
                await deleteReview(id);
                showToast('Review deleted successfully!', 'success');
                await loadAdminData();
                if (selectedTeacher) {
                    const response = await getTeacherDetail(selectedTeacher.id);
                    setSelectedTeacher(mapTeacherDetail(response.data, selectedTeacher));
                }
            } catch (error) {
                showToast('Failed to delete review', 'error');
            } finally {
                setAdminMutationLoading(false);
            }
        }
    }, [selectedTeacher, loadAdminData, showToast]);



    const handleDeleteQuestion = useCallback(async (id: number) => {
        if (window.confirm('Are you sure you want to delete this question and all its answers?')) {
            setAdminMutationLoading(true);
            try {
                await deleteQuestion(id);
                showToast('Question deleted successfully!', 'success');
                await loadAdminData();
                if (selectedTeacher) {
                    const response = await getTeacherDetail(selectedTeacher.id);
                    setSelectedTeacher(mapTeacherDetail(response.data, selectedTeacher));
                }
            } catch (error) {
                showToast('Failed to delete question', 'error');
            } finally {
                setAdminMutationLoading(false);
            }
        }    }, [selectedTeacher, loadAdminData, showToast]);

    const handleUpdateReview = useCallback(async (id: number, data: { comment: string; user_name?: string; is_approved?: boolean }) => {
        setAdminMutationLoading(true);
        try {
            await updateReview(id, data);
            showToast('Review updated successfully!', 'success');
            await loadAdminData();
            if (selectedTeacher) {
                const response = await getTeacherDetail(selectedTeacher.id);
                setSelectedTeacher(mapTeacherDetail(response.data, selectedTeacher));
            }
        } catch (error) {
            showToast('Failed to update review', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [selectedTeacher, loadAdminData, showToast]);

    const handleApproveReview = useCallback(async (id: number) => {
        setAdminMutationLoading(true);
        try {
            await approveReview(id);
            showToast('Review approved!', 'success');
            await loadAdminData();
            if (selectedTeacher) {
                const response = await getTeacherDetail(selectedTeacher.id);
                setSelectedTeacher(mapTeacherDetail(response.data, selectedTeacher));
            }
        } catch (error) {
            showToast('Failed to approve review', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [selectedTeacher, loadAdminData, showToast]);

    const handleRejectReview = useCallback(async (id: number) => {
        setAdminMutationLoading(true);
        try {
            await rejectReview(id);
            showToast('Review rejected!', 'success');
            await loadAdminData();
            if (selectedTeacher) {
                const response = await getTeacherDetail(selectedTeacher.id);
                setSelectedTeacher(mapTeacherDetail(response.data, selectedTeacher));
            }
        } catch (error) {
            showToast('Failed to reject review', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [selectedTeacher, loadAdminData, showToast]);



    const handleUpdateQuestion = useCallback(async (id: number, data: { question?: string; is_approved?: boolean }) => {
        setAdminMutationLoading(true);
        try {
            const res = await updateQuestion(id, data);
            showToast(res.data?.message || 'Question updated', 'success');
            await loadAdminData();
        } catch (error) {
            showToast('Failed to update question', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [loadAdminData, showToast]);

    const handleUpdateAnswer = useCallback(async (id: number, data: { answer?: string; is_approved?: boolean }) => {
        setAdminMutationLoading(true);
        try {
            const res = await updateAnswer(id, data);
            showToast(res.data?.message || 'Answer updated', 'success');
            await loadAdminData();
        } catch (error) {
            showToast('Failed to update answer', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [loadAdminData, showToast]);

    const handleDeleteAnswer = useCallback(async (id: number) => {
        if (!window.confirm('Delete this answer permanently? This cannot be undone.')) return;
        setAdminMutationLoading(true);
        try {
            await deleteAnswer(id);
            showToast('Answer deleted successfully!', 'success');
            await loadAdminData();
            if (selectedTeacher) {
                const response = await getTeacherDetail(selectedTeacher.id);
                setSelectedTeacher(mapTeacherDetail(response.data, selectedTeacher));
            }
        } catch (error) {
            showToast('Failed to delete answer', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [selectedTeacher, loadAdminData, showToast]);

    const handleBulkReviewDecision = useCallback(async (ids: number[], action: 'approve' | 'reject') => {
        setAdminMutationLoading(true);
        try {
            const res = await bulkReviewDecision(ids, action);
            const updated = res.data?.updated ?? ids.length;
            showToast(`${updated} review(s) ${action === 'approve' ? 'approved' : 'rejected'}`, 'success');
            await loadAdminData();
        } catch (error) {
            showToast('Bulk update failed', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [loadAdminData, showToast]);

    const handleSubmitReview = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedTeacher) {
            setReviewError('No teacher selected');
            return;
        }
        if (!reviewComment.trim()) {
            setReviewError('Please write at least 15 characters so your review is useful.');
            return;
        }
        if (reviewComment.trim().length < 15) {
            setReviewError('Please write at least 15 characters so the review is useful to other students.');
            return;
        }
        setSubmitting(true);
        setReviewError('');
        try {
            const reviewPayload: { teacher_id: number; comment: string; user_name: string; courses?: string[] } = {
                teacher_id: selectedTeacher.id,
                comment: reviewComment.trim(),
                user_name: reviewUserName.trim() || 'Anonymous',
            };
            if (reviewCourses.length > 0) reviewPayload.courses = reviewCourses;
            const res = await submitReview(reviewPayload);
            const pendingReview = Boolean(res.data?.pending);
            showToast(res.data?.message || 'Review submitted successfully!', pendingReview ? 'info' : 'success');
            haptic([12, 40, 12]);
            setShowReviewForm(false);
            setReviewComment('');
            setReviewUserName('');
            setReviewCourses([]);
            setReviewError('');
            setReviewSuccess(pendingReview
                ? `Thank you. Your review of ${selectedTeacher.name} is with a moderator and will appear once approved.`
                : `Thank you. Your review of ${selectedTeacher.name} has been received.`);

            const response = await getTeacherDetail(selectedTeacher.id);
            setSelectedTeacher(mapTeacherDetail(response.data, selectedTeacher));
            await loadTeachers(1);
            // Public visitors must not trigger an authenticated admin reload.
            if (isAdminLoggedIn) await loadAdminData();
        } catch (err) {
            console.error('Submit error:', err);
            const axiosErr = err as { response?: { data?: { error?: string } } };
            setReviewError(axiosErr.response?.data?.error || 'Failed to submit review');
        } finally {
            setSubmitting(false);
        }
    }, [selectedTeacher, reviewComment, reviewUserName, reviewCourses, loadTeachers, loadAdminData, isAdminLoggedIn, showToast]);

    const handleTeacherClick = useCallback(async (teacher: Teacher) => {
        searchInputRef.current?.blur();
        try {
            const response = await getTeacherDetail(teacher.id);
            setSelectedTeacher(mapTeacherDetail(response.data));
            setShowReviewForm(false);
            setShowQnA(false);
            setReviewComment('');
            setReviewUserName('');
            setReviewCourses([]);
            setReviewError('');
            setReviewSuccess('');

            // On mobile the detail opens as its own page (list is hidden):
            // remember list scroll position, then jump to the top of the page.
            if (window.innerWidth <= 768) {
                listScrollPosRef.current = window.scrollY;
                window.scrollTo({ top: 0, behavior: 'auto' });
            }

            navigate(`/teacher/${teacher.id}`);
        } catch (error) {
            console.error('Error loading teacher details:', error);
            showToast('Failed to load teacher details', 'error');
        }
    }, [navigate, showToast, searchInputRef]);

    // Reviews are paginated (50/page): append the next page instead of replacing
    // the list the reader is already scrolling through.
    const handleLoadMoreTeacherReviews = useCallback(async () => {
        if (!selectedTeacher || reviewsLoadingMore) return;
        const nextPage = (selectedTeacher.review_pagination?.page || 1) + 1;
        setReviewsLoadingMore(true);
        try {
            const response = await getTeacherDetail(selectedTeacher.id, nextPage);
            setSelectedTeacher((prev) => {
                if (!prev || prev.id !== selectedTeacher.id) return prev;
                const merged = mapTeacherDetail(response.data, prev);
                const seen = new Set((prev.reviews || []).map((review) => review.id));
                const extra = (merged.reviews || []).filter((review) => !seen.has(review.id));
                return { ...merged, reviews: [...(prev.reviews || []), ...extra] };
            });
        } catch (error) {
            console.error('Error loading more reviews:', error);
            showToast('Failed to load more reviews', 'error');
        } finally {
            setReviewsLoadingMore(false);
        }
    }, [selectedTeacher, reviewsLoadingMore, showToast]);

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
        setShowQnA(false);
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

    const fetchCompareDetails = useCallback(async (list: Teacher[]) => {
        setCompareLoading(true);
        try {
            const results = await Promise.all(list.map(t => getTeacherDetail(t.id)));
            const details: TeacherDetail[] = results.map((res) => mapTeacherDetail(res.data));
            setCompareDetails(details);
            return true;
        } catch (error) {
            console.error('Error loading compare data:', error);
            showToast('Failed to load comparison data', 'error');
            return false;
        } finally {
            setCompareLoading(false);
        }
    }, [showToast]);

    const runCompare = useCallback(async () => {
        if (compareList.length < 2) {
            showToast('Select at least 2 teachers to compare', 'info');
            return;
        }
        const ok = await fetchCompareDetails(compareList);
        if (!ok) return;
        setIsComparing(true);
        setSelectedTeacher(null);
        navigate('/');
        // On mobile compare is its own page (list hidden): save scroll, go to top
        if (window.innerWidth <= 768) {
            listScrollPosRef.current = window.scrollY;
            window.scrollTo({ top: 0, behavior: 'auto' });
        }
    }, [compareList, fetchCompareDetails, navigate, showToast]);

    const handleCompareAdd = useCallback((teacher: Teacher) => {
        haptic(8);
        if (compareList.some(t => t.id === teacher.id)) {
            showToast('This teacher is already in the comparison', 'info');
            return;
        }
        if (compareList.length >= 3) {
            showToast('You can compare up to 3 teachers at once', 'info');
            return;
        }
        const next = [...compareList, teacher];
        setCompareList(next);
        if (next.length >= 2) {
            fetchCompareDetails(next);
        }
    }, [compareList, fetchCompareDetails, showToast]);

    const handleCardCompare = useCallback(async (teacher: Teacher) => {
        haptic(8);
        const exists = compareList.some(t => t.id === teacher.id);
        let next: Teacher[];
        if (exists) {
            next = compareList.filter(t => t.id !== teacher.id);
        } else if (compareList.length >= 3) {
            showToast('You can compare up to 3 teachers at once', 'info');
            return;
        } else {
            next = [...compareList, teacher];
        }
        setCompareList(next);
        setSelectedTeacher(null);
        setShowReviewForm(false);
        setIsComparing(true);
        navigate('/');
        if (next.length >= 2) {
            await fetchCompareDetails(next);
        }
        // Compare is a page on mobile (list hidden); on desktop just scroll to the panel
        if (window.innerWidth <= 768) {
            listScrollPosRef.current = window.scrollY;
            window.scrollTo({ top: 0, behavior: 'auto' });
        } else {
            setTimeout(() => mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
        }
    }, [compareList, fetchCompareDetails, navigate, showToast]);

    const displayTeachers = isSearching ? searchResults : teachers;

    const loadMore = useCallback(() => {
        if (!isSearching && hasMore && !loadingMore) {
            setCurrentPage(prev => prev + 1);
        }
    }, [isSearching, hasMore, loadingMore]);

    const handleLoadMoreTeachers = useCallback(() => {
        if (!loadingMore) {
            setCurrentPage(prev => prev + 1);
        }
    }, [loadingMore]);

    // ========== BOTTOM NAV (mobile) ==========
    const handleTabHome = useCallback(() => {
        haptic(10);
        setShowMobileMenu(false);
        setSelectedTeacher(null);
        setIsComparing(false);
        setShowQnA(false);
        setShowReviewForm(false);
        setReviewSuccess('');
        navigate('/');
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
    }, [navigate]);

    // Open the site-wide Q&A board (header button + mobile bottom nav).
    const handleOpenQnA = useCallback(() => {
        haptic(10);
        setShowMobileMenu(false);
        setSelectedTeacher(null);
        setIsComparing(false);
        setShowReviewForm(false);
        setReviewSuccess('');
        setShowQnA(true);
        navigate('/questions');
        setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 80);
    }, [navigate]);

    const handleTabCompare = useCallback(() => {
        haptic(10);
        setShowMobileMenu(false);
        setSelectedTeacher(null);
        setShowQnA(false);
        setShowReviewForm(false);
        if (!isComparing) {
            navigate('/');
            setIsComparing(true);
            if (compareList.length >= 2) {
                runCompare();
            }
        }
        // Compare is a page on mobile (list hidden): go to top; desktop scrolls to panel
        if (window.innerWidth <= 768) {
            window.scrollTo({ top: 0, behavior: 'auto' });
        } else {
            setTimeout(() => {
                mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                compareSearchInputRef.current?.focus();
            }, 140);
        }
    }, [isComparing, compareList.length, runCompare, navigate]);

    const handleTabAdmin = useCallback(() => {
        haptic(10);
        setShowMobileMenu(false);
        openAdminPanel();
        if (isAdminLoggedIn) {
            loadAdminData();
            loadTeachers(1);
        }
    }, [isAdminLoggedIn, loadAdminData, loadTeachers, openAdminPanel]);

    // ========== RENDER ==========
    if (showAdminPanel) {
        if (!isAdminLoggedIn) {
            // On a refresh at /admin the cookie check needs a moment; don't
            // flash the login form (or the public site) in the meantime.
            if (!adminAuthChecked) {
                return (
                    <div className="app">
                        <ToastHost toasts={toasts} onDismiss={dismissToast} />
                        <header className={`header${headerScrolled ? ' header-scrolled' : ''}`}>
                            <h1>Teacher Review System - Admin</h1>
                            <button onClick={closeAdminPanel} className="back-to-site-btn">← Back to Site</button>
                        </header>
                        <div className="container">
                            <div className="loading" role="status">Checking admin session…</div>
                        </div>
                    </div>
                );
            }
            return (
                <div className="app">
                    <ToastHost toasts={toasts} onDismiss={dismissToast} />
                <header className={`header${headerScrolled ? ' header-scrolled' : ''}`}>
                        <h1>Teacher Review System - Admin</h1>
                        <button onClick={closeAdminPanel} className="back-to-site-btn">← Back to Site</button>
                    </header>
                    <div className="container">
                        <ErrorBoundary>
                        <LoginForm
                            adminUsername={adminUsername}
                            setAdminUsername={setAdminUsername}
                            adminPassword={adminPassword}
                            setAdminPassword={setAdminPassword}
                            adminError={adminError}
                            onLogin={handleAdminLogin}
                            requires_totp={requires_totp}
                            admin_totp_code={admin_totp_code}
                            setAdmin_totp_code={setAdmin_totp_code}
                        />
                        </ErrorBoundary>
                    </div>
                </div>
            );
        }
        return (
            <div className="app">
                <ToastHost toasts={toasts} onDismiss={dismissToast} />
                <header className="header">
                    <h1>Teacher Review System - Admin Panel</h1>
                    <button onClick={closeAdminPanel} className="back-to-site-btn">← Back to Site</button>
                </header>
                <div className="container">
                    <ErrorBoundary>
                    <AdminPanel
                        teachers={teachers}
                        reviewsForModeration={reviewsForModeration}
                        totalReviewsCount={adminStats?.total_reviews ?? 0}
                        pendingReviewsCount={adminStats?.pending_reviews ?? 0}
                        reviewsPendingOnly={reviewsPendingOnly}
                        onTogglePendingOnly={handleTogglePendingOnly}
                        onAddTeacher={handleAddTeacher}
                        onUpdateTeacher={handleUpdateTeacher}
                        onDeleteTeacher={handleDeleteTeacher}
                        onDeleteReview={handleDeleteReview}
                        onUpdateReview={handleUpdateReview}
                        onLogout={handleAdminLogout}
                        showAddTeacherForm={showAddTeacherForm}
                        setShowAddTeacherForm={setShowAddTeacherForm}
                        newTeacherName={newTeacherName}
                        setNewTeacherName={setNewTeacherName}
                        newTeacherDepartment={newTeacherDepartment}
                        setNewTeacherDepartment={setNewTeacherDepartment}
                        departmentOptions={departments.map((d) => d.department)}
                        newTeacherImage={newTeacherImage}
                        setNewTeacherImage={setNewTeacherImage}
                        totalTeachersCount={totalTeachersCount}
                        loadingMore={loadingMore}
                        onLoadMore={handleLoadMoreTeachers}
                        searchTerm={adminSearchTerm}
                        onSearchChange={handleAdminSearch}
                        searchResults={adminSearchResults}
                        isSearching={adminIsSearching}
                        onLoadMoreReviews={handleLoadMoreReviews}
                        adminLoadingMoreReviews={adminLoadingMoreReviews}
                        adminReviewsTotalPages={adminReviewsTotalPages}
                        adminReviewsPage={adminReviewsPage}
                        adminQuestions={adminQuestions}
                        onDeleteQuestion={handleDeleteQuestion}
                        onUpdateQuestion={handleUpdateQuestion}
                        onUpdateAnswer={handleUpdateAnswer}
                        onDeleteAnswer={handleDeleteAnswer}
                        onBulkReviewDecision={handleBulkReviewDecision}
                        adminMutationLoading={adminMutationLoading}
                        adminLoadingMoreQuestions={adminLoadingMoreQuestions}
                        adminQuestionsPage={adminQuestionsPage}
                        adminQuestionsTotalPages={adminQuestionsTotalPages}
                        onLoadMoreQuestions={handleLoadMoreQuestions}
                        customCourses={customCourses}
                        onReviewCourse={handleReviewCustomCourse}
                        onLoadTeacherDetail={handleLoadTeacherDetail}
                        onCleanTeacherImages={handleCleanTeacherImages}
                        onApproveReview={handleApproveReview}
                        onRejectReview={handleRejectReview}
                        reports={adminReports}
                        openReportsCount={adminStats?.open_reports ?? 0}
                        reportsStatus={adminReportsStatus}
                        onReportsStatusChange={handleReportsStatusChange}
                        onUpdateReportStatus={handleUpdateReportStatus}
                        onLoadMoreReports={handleLoadMoreReports}
                        adminReportsPage={adminReportsPage}
                        adminReportsTotalPages={adminReportsTotalPages}
                        adminLoadingMoreReports={adminLoadingMoreReports}
                        totpEnabled={adminTotpEnabled}
                    />
                    </ErrorBoundary>
                </div>
            </div>
        );
    }

    return (
        <div className="app">
            <ToastHost toasts={toasts} onDismiss={dismissToast} />
            {reviewSuccess && compareList.length === 0 && !isComparing && !showQnA && <InstallPrompt />}
            <PullToRefresh onRefresh={handlePullRefresh}>
                <header className="header" role="banner">
                    <div className="header-top">
                        <a
                            className="header-brand"
                            href="/"
                            onClick={(e) => { e.preventDefault(); handleTabHome(); }}
                            title="Back to the start page"
                            aria-label="UMT Teacher Reviews - go to start page"
                        >
                            <img
                                src={`${import.meta.env.BASE_URL}umt-logo.png`}
                                alt="UMT Logo"
                                className="header-logo"
                                width={48}
                                height={48}
                                decoding="async"
                            />
                            <h1 style={{ margin: 0 }}>UMT Teacher Reviews</h1>
                        </a>
                        <button
                            className={`menu-toggle${showMobileMenu ? ' menu-toggle-open' : ''}`}
                            onClick={() => setShowMobileMenu(v => !v)}
                            aria-expanded={showMobileMenu}
                            aria-label={showMobileMenu ? 'Close menu' : 'Open menu'}
                        >
                            {showMobileMenu ? <Icon name="x" size={22} /> : <Icon name="menu" size={22} />}
                        </button>
                    </div>
                    <p className="header-tagline">Reviews from UMT students, for UMT students.</p>
                    <div className={`header-actions${showMobileMenu ? ' header-actions-open' : ''}`}>
                        <button onClick={handleTabAdmin} className="admin-login-btn">
                            <Icon name="lock" size={16} /> Admin login
                        </button>
                        <button onClick={handleOpenQnA} className="admin-login-btn">
                            <Icon name="message-square" size={16} /> Q&amp;A
                        </button>
                        <button onClick={() => { setShowContactModal(true); setShowMobileMenu(false); }} className="admin-login-btn">
                            <Icon name="mail" size={16} /> Contact us
                        </button>
                        <button onClick={() => { setShowAboutModal(true); setShowMobileMenu(false); }} className="admin-login-btn">
                            <Icon name="info" size={16} /> About
                        </button>
                    </div>
                </header>

                <div className={`container${selectedTeacher && !isComparing ? ' container-detail' : ''}`}>
                <div className={`sidebar${(selectedTeacher || isComparing || showQnA) && isMobileViewport ? ' sidebar-hidden-mobile' : ''}`}>
                    <div className="search-box">
                        <TeacherAutocomplete
                            value={searchTerm}
                            onQueryChange={handleSearch}
                            inputRef={searchInputRef}
                            onSelect={(teacher) => {
                                setSearchTerm('');
                                setIsSearching(false);
                                setSearchResults([]);
                                setSearchParams((prev) => {
                                    const next = new URLSearchParams(prev);
                                    next.delete('search');
                                    return next;
                                }, { replace: true });
                                handleTeacherClick(teacher);
                            }}
                            onCompare={(teacher) => {
                                if (window.innerWidth > 768) {
                                    handleCardCompare(teacher);
                                } else {
                                    toggleCompare(teacher);
                                }
                            }}
                            isInCompare={(teacher) => compareList.some(t => t.id === teacher.id)}
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
                                    <TeacherCardSkeleton key={i} />
                                ))}
                            </>
                        ) : error ? (
                            <div className="error-message">
                                {error} <button onClick={() => loadTeachers(1)} className="retry-btn">Retry</button>
                            </div>
                        ) : displayTeachers.length === 0 ? (
                            <div className="no-results">No teachers match your search. Try a shorter name or a department.</div>
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
                                            maxTilt={6}
                                            onClick={() => handleTeacherClick(teacher)}
                                        >
                                            <Avatar name={teacher.name} imageUrl={teacher.image_url} className="teacher-card-image" priority={index < 6} />
                                            <div className="teacher-card-info">
                                                <h3 title={teacher.name}>{teacher.name}</h3>
                                                <p className="department" title={teacher.department}>{teacher.department}</p>
                                                <span className="reviews-count">
                                                    ({teacher.review_count} {teacher.review_count === 1 ? 'review' : 'reviews'})
                                                </span>
                                            </div>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (window.innerWidth > 768) {
                                                        handleCardCompare(teacher);
                                                    } else {
                                                        toggleCompare(teacher);
                                                    }
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
                                            Show more teachers ({teachers.length} / {totalTeachersCount})
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

                <main className={`main-content${selectedTeacher && !isComparing ? ' main-content-detail' : ''}`} id="main-content" ref={mainContentRef}>
                <ErrorBoundary>
                    {showQnA ? (
                        <QuestionsView onOpenTeacher={handleTeacherClick} onBack={handleTabHome} />
                    ) : isComparing ? (
                        <CompareView
                            compareDetails={compareDetails}
                            compareList={compareList}
                            compareSearchTerm={compareSearchTerm}
                            setCompareSearchTerm={setCompareSearchTerm}
                            compareSearchInputRef={compareSearchInputRef}
                            handleCompareAdd={handleCompareAdd}
                            setIsComparing={setIsComparing}
                            restoreListScroll={restoreListScroll}
                            handleTeacherClick={handleTeacherClick}
                            setCompareList={setCompareList}
                            setCompareDetails={setCompareDetails}
                        />
                    ) : selectedTeacher ? (
                        <TeacherDetailView
                            selectedTeacher={selectedTeacher}
                            relatedTeachers={relatedTeachers}
                            reviewSuccess={reviewSuccess}
                            reviewError={reviewError}
                            onShowReviewForm={() => { if (selectedTeacher && selectedTeacher.id) setShowReviewForm(true); }}
                            onClearSelectedTeacher={clearSelectedTeacher}
                            onTeacherClick={handleTeacherClick}
                            showToast={showToast}
                            reviewsLoading={reviewsLoadingMore}
                            onLoadMoreReviews={handleLoadMoreTeacherReviews}
                        />
                    ) : (
                        <div className="welcome-message">
                            <div className="welcome-crest">
                                <span className="welcome-crest-plate">
                                    <img
                                        src={`${import.meta.env.BASE_URL}umt-logo.png`}
                                        alt="University of Management and Technology"
                                        className="welcome-crest-img"
                                        width={96}
                                        height={96}
                                        decoding="async"
                                    />
                                </span>
                            </div>
                            <p className="welcome-eyebrow">University of Management and Technology · Lahore</p>
                            <h2 className="welcome-title">Reviews from UMT students, for UMT students.</h2>
                            <p className="welcome-hint-desktop">Find a teacher to read reviews, or add what you know about a class.</p>
                            <p className="welcome-hint-mobile">Find a teacher above to read reviews, or add what you know about a class.</p>
                            <p className="welcome-trust">Anonymous. Moderated. Free.</p>
                            {departments.length > 0 && (
                                <div className="department-links">
                                    <h3>Browse by department</h3>
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
                </ErrorBoundary>
                </main>
            </div>

            <footer className="app-footer" role="contentinfo">
                <div className="footer-content">
                    <p>© {new Date().getFullYear()} UMT Teacher Reviews. All rights reserved.</p>
                    <p className="footer-links">
                        <a href="/privacy">Privacy Policy</a> · <a href="/terms">Terms of Use</a> · <a href="/dmca">DMCA &amp; Content Removal</a> · <a href="/contact">Contact</a>
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
                <ReviewFormModal
                    selectedTeacher={selectedTeacher}
                    reviewComment={reviewComment}
                    setReviewComment={setReviewComment}
                    reviewUserName={reviewUserName}
                    setReviewUserName={setReviewUserName}
                    reviewCourses={reviewCourses}
                    setReviewCourses={setReviewCourses}
                    reviewError={reviewError}
                    submitting={submitting}
                    onSubmit={handleSubmitReview}
                    onClose={() => setShowReviewForm(false)}
                />
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
                    { key: 'home', label: 'Home', icon: 'home', active: !isComparing && !showQnA && !selectedTeacher, onClick: handleTabHome },
                    { key: 'qna', label: 'Q&A', icon: 'message-square', active: showQnA, onClick: handleOpenQnA },
                    { key: 'compare', label: 'Compare', icon: 'compare', active: isComparing, onClick: handleTabCompare },
                    { key: 'admin', label: 'Admin', icon: 'lock', onClick: handleTabAdmin },
                ]}
            />
        </div>
    );
};

export default App;
