import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_BASE || '/api';

const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000, // 60 seconds for cold start
    withCredentials: true, // send the HttpOnly admin cookie on cross-origin requests
});

// ========== HELPERS ==========

/** Read a cookie value by name (no library needed). */
function getCookie(name: string): string | null {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[.$?*|{}()[\]\\]/g, '\\$&') + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
}

// ========== INTERCEPTORS ==========

// Request interceptor – attach CSRF token header on state-changing requests
api.interceptors.request.use((config) => {
    const safeMethods = ['get', 'head', 'options'];
    if (!safeMethods.includes((config.method || 'get').toLowerCase())) {
        const csrfToken = getCookie('csrf_token');
        if (csrfToken) {
            config.headers.set('X-CSRF-Token', csrfToken);
        }
    }
    return config;
});

// Response interceptor – handle 401/403 (session expired)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        const status = error.response?.status;
        const url = String(error.config?.url || '');
        // Wrong credentials also answer 401, and a bad CSRF token answers 403.
        // Never treat the login request itself as an expired session, or the
        // form would unmount while the user is still typing.
        const isLoginRequest = url.includes('/admin/login');
        if (!isLoginRequest && (status === 401 || status === 403)) {
            // Dispatch a custom event that App can listen to. App ignores it
            // when no admin session is active, so public 403s are harmless.
            window.dispatchEvent(new CustomEvent('admin-session-expired'));
        }
        return Promise.reject(error);
    }
);

// ========== PUBLIC APIs ==========

export const getTeachers = (page: number = 1, sort: string = 'name', department?: string, limit: number = 20) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
    if (department) params.set('department', department);
    return api.get(`/teachers?${params.toString()}`);
};

export const getDepartments = () => {
    return api.get('/departments');
};

export const getRelatedTeachers = (id: number) => {
    return api.get(`/teachers/${id}/related`);
};

export const searchAllTeachers = (query: string, limit?: number, signal?: AbortSignal) => {
    if (!query || query.trim() === '') {
        return Promise.resolve({ data: [] });
    }
    const params = new URLSearchParams({ q: query });
    if (limit) params.set('limit', String(limit));
    return api.get(`/teachers/search?${params.toString()}`, { signal });
};

export const getTeacherDetail = (id: number, reviewPage: number = 1, reviewLimit: number = 50) => {
    return api.get(`/teachers/${id}?review_page=${reviewPage}&review_limit=${reviewLimit}`);
};

// ========== Q&A APIs ==========

export interface Question {
    id: number;
    question: string;
    created_at: string;
    answers: { id: number; answer: string; created_at: string }[];
}

export const getTeacherQuestions = (id: number) => {
    return api.get(`/teachers/${id}/questions`);
};

/** A question from the site-wide Q&A board (includes its teacher). */
export interface BoardQuestion {
    id: number;
    question: string;
    created_at: string;
    teacher_id: number;
    teacher_name: string;
    teacher_department: string;
    answers: { id: number; answer: string; created_at: string }[];
}

/** Every approved question across all teachers, newest first. */
export const getAllQuestions = (page: number = 1, limit: number = 15) => {
    return api.get(`/questions?page=${page}&limit=${limit}`);
};

export const submitQuestion = (data: { teacher_id: number; question: string }) => {
    return api.post('/questions', data);
};

export const submitAnswer = (questionId: number, answer: string) => {
    return api.post(`/questions/${questionId}/answers`, { answer });
};

export const submitReview = (data: { 
    teacher_id: number; 
    comment: string; 
    user_name?: string;
    courses?: string[];
}) => {
    const teacherId = Number(data.teacher_id);
    if (isNaN(teacherId) || teacherId <= 0) {
        return Promise.reject({ response: { data: { error: 'Invalid teacher ID' } } });
    }
    const reviewData: Record<string, any> = {
        teacher_id: teacherId,
        comment: data.comment,
        user_name: data.user_name || 'Anonymous'
    };
    if (data.courses && data.courses.length > 0) reviewData.courses = data.courses;
    return api.post('/reviews', reviewData);
};

// Report a published review for moderator attention.
export const reportReview = (reviewId: number, reason: string) => {
    return api.post(`/reviews/${reviewId}/report`, { reason });
};


// ========== CUSTOM COURSES (community-added, admin-approved) ==========

export const getApprovedCustomCourses = () => {
    return api.get('/custom-courses');
};

export const suggestCustomCourse = (name: string) => {
    return api.post('/custom-courses', { name });
};

export const getAdminCustomCourses = () => {
    return api.get('/admin/custom-courses');
};

export const reviewCustomCourse = (id: number, action: 'approve' | 'reject') => {
    return api.put(`/admin/custom-courses/${id}`, { action });
};

// ========== ADMIN APIs ==========

export const adminLogin = (username: string, password: string) => {
    return api.post('/admin/login', { username, password });
};

export const adminMe = () => {
    return api.get('/admin/me');
};

export const adminLogout = () => {
    return api.post('/admin/logout');
};

export const addTeacher = (data: { name: string; department: string; image_url?: string }) => {
    return api.post('/admin/teachers', data);
};

export const deleteTeacher = (id: number) => {
    return api.delete(`/admin/teachers/${id}`);
};

/**
 * Update an existing teacher (admin only)
 */
export const updateTeacher = (id: number, data: { name: string; department: string; image_url?: string }) => {
    return api.put(`/admin/teachers/${id}`, data);
};

/**
 * Get full teacher details for admin (all reviews incl. pending + stats)
 */
export const getAdminTeacherDetail = (id: number) => {
    return api.get(`/admin/teachers/${id}`);
};

export const getAdminReviews = (page: number = 1, limit: number = 50, pendingOnly: boolean = false) => {
    return api.get(`/admin/reviews?page=${page}&limit=${limit}${pendingOnly ? '&pending=1' : ''}`);
};

export const deleteReview = (id: number) => {
    return api.delete(`/admin/reviews/${id}`);
};

export const bulkReviewDecision = (ids: number[], action: 'approve' | 'reject') => {
    return api.post('/admin/reviews/bulk', { ids, action });
};

export const approveReview = (id: number) => {
    return api.put(`/admin/reviews/${id}`, { is_approved: true });
};

export const rejectReview = (id: number) => {
    return api.put(`/admin/reviews/${id}`, { is_approved: false });
};

export const updateReview = (id: number, data: { comment: string; user_name?: string; is_approved?: boolean }) => {
    return api.put(`/admin/reviews/${id}`, data);
};

export type { AdminQuestion } from '../types';

export const getAdminQuestions = (page: number = 1, limit: number = 50) => {
    return api.get(`/admin/questions?page=${page}&limit=${limit}`);
};

export const deleteQuestion = (id: number) => {
    return api.delete(`/admin/questions/${id}`);
};

export const updateQuestion = (id: number, data: { question?: string; is_approved?: boolean }) => {
    return api.put(`/admin/questions/${id}`, data);
};

export const updateAnswer = (id: number, data: { answer?: string; is_approved?: boolean }) => {
    return api.put(`/admin/answers/${id}`, data);
};

export const deleteAnswer = (id: number) => {
    return api.delete(`/admin/answers/${id}`);
};

// ========== READER REPORTS (admin) ==========

export const getAdminReports = (page: number = 1, limit: number = 50, status: 'open' | 'resolved' | 'dismissed' = 'open') => {
    return api.get(`/admin/reports?page=${page}&limit=${limit}&status=${status}`);
};

export const updateReportStatus = (id: number, status: 'open' | 'resolved' | 'dismissed') => {
    return api.put(`/admin/reports/${id}`, { status });
};

export const getAdminStats = () => {
    return api.get('/admin/stats');
};

/**
 * Clear teacher photo URLs that aren't real images (e.g. a bare directory URL
 * with no filename). Pass dryRun to preview without changing anything.
 */
export const cleanTeacherImages = (dryRun: boolean = false) => {
    return api.post(`/admin/clean-teacher-images?dryRun=${dryRun ? 'true' : 'false'}`, {});
};

export default api;
