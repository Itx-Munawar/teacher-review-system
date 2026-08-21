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
    getAdminStats,
    deleteQuestion,
    submitReview
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
import AdminPanel from './components/AdminPanel';
import LoginForm from './components/LoginForm';
import CompareView from './components/CompareView';
import TeacherDetailView from './components/TeacherDetailView';
import ReviewFormModal from './components/ReviewFormModal';
import ErrorBoundary from './components/ErrorBoundary';
import { TeacherCardSkeleton } from './components/Skeleton';
import { ToastHost } from './components/Toast';
import { haptic } from './utils/haptics';
import { timeAgo } from './utils/timeAgo';
import type { Teacher, Review, TeacherDetail, AdminReview, AdminQuestion, Toast } from './types';
import './App.css';

// ========== HELPER: Map API response to TeacherDetail ==========
const mapTeacherDetail = (data: any, fallback?: TeacherDetail): TeacherDetail => {
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
};

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
    const [compareSearchTerm, setCompareSearchTerm] = useState('');
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [reviewComment, setReviewComment] = useState('');
    const [reviewUserName, setReviewUserName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [reviewError, setReviewError] = useState('');
    const [reviewSuccess, setReviewSuccess] = useState('');

    const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
    const [adminMutationLoading, setAdminMutationLoading] = useState(false);
    const [showAdminPanel, setShowAdminPanel] = useState(false);
    const [adminUsername, setAdminUsername] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [adminError, setAdminError] = useState('');
    const [showAddTeacherForm, setShowAddTeacherForm] = useState(false);
    const [newTeacherName, setNewTeacherName] = useState('');
    const [newTeacherDepartment, setNewTeacherDepartment] = useState('');
    const [newTeacherImage, setNewTeacherImage] = useState('');
    const [reviewsForModeration, setReviewsForModeration] = useState<AdminReview[]>([]);
    const [adminStats, setAdminStats] = useState<{ total_teachers: number; total_reviews: number; reviews_last_week: number } | null>(null);

    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastIdRef = useRef(0);

    const mainContentRef = useRef<HTMLDivElement>(null);
    const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const listScrollPosRef = useRef(0);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const compareSearchInputRef = useRef<HTMLInputElement>(null);

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

    const debouncedAdminSearch = useRef(debounce(async (value: string) => {
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

        // Fetch actual totals from the stats endpoint
        try {
            const statsRes = await getAdminStats();
            setAdminStats(statsRes.data);
        } catch (err) {
            console.error('Error loading admin stats:', err);
        }
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
                    setSelectedTeacher(mapTeacherDetail(response.data));
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
                setSelectedTeacher(mapTeacherDetail(response.data));
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
        } catch (error) {
            const err = error as { response?: { data?: { error?: string } } };
            setAdminError(err.response?.data?.error || 'Login failed');
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
        setAdminMutationLoading(true);
        try {
            await updateTeacher(id, data);
            showToast('Teacher updated successfully!', 'success');
            loadTeachers(1);
            await loadAdminData();
        } catch (error) {
            console.error('Update error:', error);
            showToast('Failed to update teacher', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [loadTeachers, loadAdminData, showToast]);

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
            await loadAdminData();
        } catch (error) {
            showToast('Failed to add teacher', 'error');
        } finally {
            setAdminMutationLoading(false);
        }
    }, [newTeacherName, newTeacherDepartment, newTeacherImage, loadTeachers, loadAdminData, showToast]);

    const handleDeleteTeacher = useCallback(async (id: number) => {
        if (window.confirm('Are you sure you want to delete this teacher? All reviews will also be deleted.')) {
            setAdminMutationLoading(true);
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
            } finally {
                setAdminMutationLoading(false);
            }
        }
    }, [selectedTeacher, loadTeachers, loadAdminData, showToast]);

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
            setSelectedTeacher(mapTeacherDetail(response.data, selectedTeacher));
            await loadTeachers(1);
            await loadAdminData();
        } catch (err) {
            console.error('Submit error:', err);
            const axiosErr = err as { response?: { data?: { error?: string } } };
            setReviewError(axiosErr.response?.data?.error || 'Failed to submit review');
        } finally {
            setSubmitting(false);
        }
    }, [selectedTeacher, reviewComment, reviewUserName, loadTeachers, loadAdminData, showToast]);

    const handleTeacherClick = useCallback(async (teacher: Teacher) => {
        searchInputRef.current?.blur();
        try {
            const response = await getTeacherDetail(teacher.id);
            setSelectedTeacher(mapTeacherDetail(response.data));
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
    }, [navigate, showToast, searchInputRef]);
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
        // Auto-scroll to compare view on mobile
        if (window.innerWidth <= 768 && mainContentRef.current) {
            listScrollPosRef.current = window.scrollY;
            setTimeout(() => {
                mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 150);
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
        setTimeout(() => mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
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
        setSelectedTeacher(null);
        setShowReviewForm(false);
        if (!isComparing) {
            navigate('/');
            setIsComparing(true);
            if (compareList.length >= 2) {
                runCompare();
            }
        }
        setTimeout(() => {
            mainContentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            compareSearchInputRef.current?.focus();
        }, 140);
    }, [isComparing, compareList.length, runCompare, navigate]);

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
                    <ToastHost toasts={toasts} onDismiss={dismissToast} />
                <header className={`header${headerScrolled ? ' header-scrolled' : ''}`}>
                        <h1>Teacher Review System - Admin</h1>
                        <button onClick={() => setShowAdminPanel(false)} className="back-to-site-btn">← Back to Site</button>
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
                        />
                        </ErrorBoundary>
                    </div>
                </div>
            );
        }
        return (
            <div className="app">
                <ParticleBackground />
                <ToastHost toasts={toasts} onDismiss={dismissToast} />
                <header className="header">
                    <h1>Teacher Review System - Admin Panel</h1>
                    <button onClick={() => setShowAdminPanel(false)} className="back-to-site-btn">← Back to Site</button>
                </header>
                <div className="container">
                    <ErrorBoundary>
                    <AdminPanel
                        teachers={teachers}
                        reviewsForModeration={reviewsForModeration}
                        totalReviewsCount={adminStats?.total_reviews ?? 0}
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
                        adminMutationLoading={adminMutationLoading}
                        adminLoadingMoreQuestions={adminLoadingMoreQuestions}
                        adminQuestionsPage={adminQuestionsPage}
                        adminQuestionsTotalPages={adminQuestionsTotalPages}
                        onLoadMoreQuestions={handleLoadMoreQuestions}
                    />
                    </ErrorBoundary>
                </div>
            </div>
        );
    }

    return (
        <div className="app">
            <ParticleBackground />
            <ToastHost toasts={toasts} onDismiss={dismissToast} />
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
                            onCompare={(teacher) => {
                                if (window.innerWidth > 768) {
                                    handleCardCompare(teacher);
                                } else {
                                    toggleCompare(teacher);
                                }
                            }}
                            isInCompare={(teacher) => compareList.some(t => t.id === teacher.id)}
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
                                    <TeacherCardSkeleton key={i} />
                                ))}
                            </>
                        ) : error ? (
                            <div className="error-message">
                                {error} <button onClick={() => loadTeachers(1)} className="retry-btn">Retry</button>
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
                <ErrorBoundary>
                    {isComparing ? (
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
                            departments={departments}
                            onShowReviewForm={() => { if (selectedTeacher && selectedTeacher.id) setShowReviewForm(true); }}
                            onClearSelectedTeacher={clearSelectedTeacher}
                            onTeacherClick={handleTeacherClick}
                            showToast={showToast}
                        />
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
                </ErrorBoundary>
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
                <ReviewFormModal
                    selectedTeacher={selectedTeacher}
                    reviewComment={reviewComment}
                    setReviewComment={setReviewComment}
                    reviewUserName={reviewUserName}
                    setReviewUserName={setReviewUserName}
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
