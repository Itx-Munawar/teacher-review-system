import type React from 'react';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Location, NavigateFunction } from 'react-router-dom';
import {
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
    getAdminCustomCourses,
    reviewCustomCourse,
    getAdminTeacherDetail,
    cleanTeacherImages,
    getAdminReports,
    updateReportStatus
} from '../services/api';
import { debounce } from '../utils/debounce';
import { mapTeacherDetail } from '../utils/teacherDetail';
import type { Teacher, TeacherDetail, AdminReview, AdminQuestion, CustomCourse, AdminTeacherDetail, AdminReport, AdminStats, Toast } from '../types';

interface UseAdminOptions {
    location: Location;
    navigate: NavigateFunction;
    showToast: (message: string, type?: Toast['type']) => void;
    loadTeachers: (page?: number, retryCount?: number) => Promise<void>;
    loadDepartments: () => void;
    /** The public teacher page, refreshed after moderation actions. */
    selectedTeacher: TeacherDetail | null;
    setSelectedTeacher: React.Dispatch<React.SetStateAction<TeacherDetail | null>>;
    setShowReviewForm: React.Dispatch<React.SetStateAction<boolean>>;
}

/**
 * Everything behind the admin panel: session (login, 2FA, logout, inactivity
 * timer), the /admin URL, moderation data with pagination, and every admin
 * action. Moved verbatim out of App.tsx; App only needs a handful of the
 * returned values, the rest is handed to <AdminScreen>.
 */
export function useAdmin({
    location,
    navigate,
    showToast,
    loadTeachers,
    loadDepartments,
    selectedTeacher,
    setSelectedTeacher,
    setShowReviewForm,
}: UseAdminOptions) {
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

    const logoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Where "Back to Site" should return after visiting /admin.
    const adminReturnPathRef = useRef('/');

    const [adminSearchTerm, setAdminSearchTerm] = useState('');
    const [adminSearchResults, setAdminSearchResults] = useState<Teacher[]>([]);
    const [adminIsSearching, setAdminIsSearching] = useState(false);

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

    useEffect(() => {
        if (isAdminLoggedIn) {
            loadAdminData();
            loadTeachers(1);
        }
    }, [isAdminLoggedIn, loadAdminData, loadTeachers]);

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

    return {
        isAdminLoggedIn,
        setIsAdminLoggedIn,
        adminAuthChecked,
        setAdminAuthChecked,
        adminMutationLoading,
        setAdminMutationLoading,
        showAdminPanel,
        setShowAdminPanel,
        adminUsername,
        setAdminUsername,
        adminPassword,
        setAdminPassword,
        adminError,
        setAdminError,
        admin_totp_code,
        setAdmin_totp_code,
        requires_totp,
        setRequires_totp,
        showAddTeacherForm,
        setShowAddTeacherForm,
        newTeacherName,
        setNewTeacherName,
        newTeacherDepartment,
        setNewTeacherDepartment,
        newTeacherImage,
        setNewTeacherImage,
        reviewsForModeration,
        setReviewsForModeration,
        adminStats,
        setAdminStats,
        adminTotpEnabled,
        setAdminTotpEnabled,
        logoutTimerRef,
        adminReturnPathRef,
        adminSearchTerm,
        setAdminSearchTerm,
        adminSearchResults,
        setAdminSearchResults,
        adminIsSearching,
        setAdminIsSearching,
        openAdminPanel,
        closeAdminPanel,
        debouncedAdminSearch,
        handleAdminSearch,
        adminReviewsPage,
        setAdminReviewsPage,
        adminReviewsTotalPages,
        setAdminReviewsTotalPages,
        adminLoadingMoreReviews,
        setAdminLoadingMoreReviews,
        adminQuestions,
        setAdminQuestions,
        adminQuestionsPage,
        setAdminQuestionsPage,
        adminQuestionsTotalPages,
        setAdminQuestionsTotalPages,
        adminLoadingMoreQuestions,
        setAdminLoadingMoreQuestions,
        customCourses,
        setCustomCourses,
        reviewsPendingOnly,
        setReviewsPendingOnly,
        adminReports,
        setAdminReports,
        adminReportsPage,
        setAdminReportsPage,
        adminReportsTotalPages,
        setAdminReportsTotalPages,
        adminLoadingMoreReports,
        setAdminLoadingMoreReports,
        adminReportsStatus,
        setAdminReportsStatus,
        adminReviewsPageRef,
        adminQuestionsPageRef,
        adminReportsPageRef,
        adminReportsStatusRef,
        loadAdminData,
        handleTogglePendingOnly,
        handleLoadMoreReviews,
        handleLoadMoreQuestions,
        handleLoadMoreReports,
        handleReportsStatusChange,
        handleUpdateReportStatus,
        handleReviewCustomCourse,
        handleLoadTeacherDetail,
        checkAdminLogin,
        handleAdminLogin,
        logoutInFlightRef,
        handleAdminLogout,
        startLogoutTimer,
        resetLogoutTimer,
        handleUpdateTeacher,
        handleCleanTeacherImages,
        handleAddTeacher,
        handleDeleteTeacher,
        handleDeleteReview,
        handleDeleteQuestion,
        handleUpdateReview,
        handleApproveReview,
        handleRejectReview,
        handleUpdateQuestion,
        handleUpdateAnswer,
        handleDeleteAnswer,
        handleBulkReviewDecision,
    };
}

export type AdminState = ReturnType<typeof useAdmin>;
