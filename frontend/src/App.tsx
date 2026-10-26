import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useSearchParams, useParams, useNavigate, useLocation } from 'react-router-dom';
import {
    getTeachers,
    getDepartments,
    getRelatedTeachers,
    searchAllTeachers,
    getTeacherDetail,
    submitReview,
    getChatStatus
} from './services/api';
import { SITE_URL } from './utils/siteUrl';
import { applySeo } from './utils/seo';
import { mapTeacherDetail } from './utils/teacherDetail';
import { useAdmin } from './hooks/useAdmin';
import InstallPrompt from './components/InstallPrompt';
import PullToRefresh from './components/PullToRefresh';
import BottomNav from './components/BottomNav';
import TeacherDetailView from './components/TeacherDetailView';
import ReviewFormModal from './components/ReviewFormModal';
import QuestionsView from './components/QuestionsView';
import ErrorBoundary from './components/ErrorBoundary';
import ChunkFallback from './components/ChunkFallback';
import AdminScreen from './components/AdminScreen';
import AppHeader from './components/AppHeader';
import AppFooter from './components/AppFooter';
import TeacherSidebar from './components/TeacherSidebar';
import WelcomePanel from './components/WelcomePanel';
import CompareBar from './components/CompareBar';
import { AboutModal, ContactModal } from './components/InfoModals';
import { ToastHost } from './components/Toast';
import { haptic } from './utils/haptics';
import type { Teacher, TeacherDetail, Toast } from './types';
import './App.css';

// The compare screen is rarely opened, so it is split into its own chunk
// instead of shipping in the bundle every visitor downloads (the admin
// screens are split the same way inside AdminScreen).
const CompareView = lazy(() => import('./components/CompareView'));
// The review assistant only loads once the server says it is switched on.
const ChatWidget = lazy(() => import('./components/ChatWidget'));

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

    const [toasts, setToasts] = useState<Toast[]>([]);
    const toastIdRef = useRef(0);

    const mainContentRef = useRef<HTMLDivElement>(null);
    const listScrollPosRef = useRef(0);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const compareSearchInputRef = useRef<HTMLInputElement>(null);

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

    // Review assistant (Gemini): shown only when the backend has a key.
    const [chatEnabled, setChatEnabled] = useState(false);
    useEffect(() => {
        getChatStatus().then((res) => setChatEnabled(Boolean(res.data?.enabled))).catch(() => setChatEnabled(false));
    }, []);

    // ========== ADMIN (session, moderation data and actions) ==========
    const admin = useAdmin({
        location,
        navigate,
        showToast,
        loadTeachers,
        loadDepartments,
        selectedTeacher,
        setSelectedTeacher,
        setShowReviewForm,
    });
    const { isAdminLoggedIn, showAdminPanel, openAdminPanel, loadAdminData, checkAdminLogin } = admin;

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

    // Picking a suggestion clears the search box and opens the teacher.
    const handleAutocompleteSelect = (teacher: Teacher) => {
        setSearchTerm('');
        setIsSearching(false);
        setSearchResults([]);
        setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.delete('search');
            return next;
        }, { replace: true });
        handleTeacherClick(teacher);
    };

    // "+" on a card or suggestion: desktop opens the compare panel right away,
    // mobile just adds to the compare bar (compare is its own page there).
    const handleCompareToggle = (teacher: Teacher) => {
        if (window.innerWidth > 768) {
            handleCardCompare(teacher);
        } else {
            toggleCompare(teacher);
        }
    };

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
        return (
            <AdminScreen
                admin={admin}
                toasts={toasts}
                dismissToast={dismissToast}
                headerScrolled={headerScrolled}
                teachers={teachers}
                departments={departments}
                totalTeachersCount={totalTeachersCount}
                loadingMore={loadingMore}
                handleLoadMoreTeachers={handleLoadMoreTeachers}
            />
        );
    }

    return (
        <div className="app">
            <ToastHost toasts={toasts} onDismiss={dismissToast} />
            {reviewSuccess && compareList.length === 0 && !isComparing && !showQnA && <InstallPrompt />}
            <PullToRefresh onRefresh={handlePullRefresh}>
                <AppHeader
                    showMobileMenu={showMobileMenu}
                    setShowMobileMenu={setShowMobileMenu}
                    handleTabHome={handleTabHome}
                    handleTabAdmin={handleTabAdmin}
                    handleOpenQnA={handleOpenQnA}
                    setShowContactModal={setShowContactModal}
                    setShowAboutModal={setShowAboutModal}
                />

                <div className={`container${selectedTeacher && !isComparing ? ' container-detail' : ''}`}>
                <TeacherSidebar
                    hiddenOnMobile={Boolean((selectedTeacher || isComparing || showQnA) && isMobileViewport)}
                    searchTerm={searchTerm}
                    handleSearch={handleSearch}
                    searchInputRef={searchInputRef}
                    handleAutocompleteSelect={handleAutocompleteSelect}
                    handleCompareToggle={handleCompareToggle}
                    compareList={compareList}
                    isSearching={isSearching}
                    searchResults={searchResults}
                    sortBy={sortBy}
                    setSortBy={setSortBy}
                    departmentFilter={departmentFilter}
                    setDepartmentFilter={setDepartmentFilter}
                    departments={departments}
                    loading={loading}
                    error={error}
                    loadTeachers={loadTeachers}
                    displayTeachers={displayTeachers}
                    handleTeacherClick={handleTeacherClick}
                    loadingMore={loadingMore}
                    hasMore={hasMore}
                    loadMore={loadMore}
                    teachers={teachers}
                    totalTeachersCount={totalTeachersCount}
                />

                <main className={`main-content${selectedTeacher && !isComparing ? ' main-content-detail' : ''}`} id="main-content" ref={mainContentRef}>
                <ErrorBoundary>
                    {showQnA ? (
                        <QuestionsView onOpenTeacher={handleTeacherClick} onBack={handleTabHome} />
                    ) : isComparing ? (
                        <Suspense fallback={<ChunkFallback />}>
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
                        </Suspense>
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
                        <WelcomePanel departments={departments} />
                    )}
                </ErrorBoundary>
                </main>
            </div>

            <AppFooter />
            </PullToRefresh>
            {showAboutModal && (
                <AboutModal onClose={() => setShowAboutModal(false)} />
            )}
            {showContactModal && (
                <ContactModal onClose={() => setShowContactModal(false)} />
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
                <CompareBar
                    compareList={compareList}
                    compareLoading={compareLoading}
                    toggleCompare={toggleCompare}
                    clearCompare={clearCompare}
                    runCompare={runCompare}
                />
            )}
            {chatEnabled && (
                <Suspense fallback={null}>
                    <ChatWidget
                        pageTeacher={selectedTeacher && !isComparing && !showQnA ? { id: selectedTeacher.id, name: selectedTeacher.name } : null}
                        onOpenTeacher={(t) => handleTeacherClick({ id: t.id, name: t.name, department: t.department, review_count: 0 })}
                        raised={compareList.length > 0 && !isComparing}
                    />
                </Suspense>
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
