import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || '/api';

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

// The server sets the csrf_token cookie on any response that lacks it. It
// lives for 24 hours, so a tab left open overnight can try to post a form
// without one; fetch a fresh cookie first instead of failing with a 403.
let csrfCookieRequest: Promise<unknown> | null = null;
function ensureCsrfCookie(): Promise<unknown> {
    if (!csrfCookieRequest) {
        csrfCookieRequest = fetch(`${API_BASE}/health`, { credentials: 'include', cache: 'no-store' })
            .catch(() => undefined)
            .finally(() => { csrfCookieRequest = null; });
    }
    return csrfCookieRequest;
}

// Request interceptor – attach CSRF token header on state-changing requests
api.interceptors.request.use(async (config) => {
    const safeMethods = ['get', 'head', 'options'];
    if (!safeMethods.includes((config.method || 'get').toLowerCase())) {
        let csrfToken = getCookie('csrf_token');
        if (!csrfToken) {
            await ensureCsrfCookie();
            csrfToken = getCookie('csrf_token');
        }
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

export const getTeachers = (page: number = 1, sort: string = 'name', department?: string, limit: number = 20, course?: string) => {
    const params = new URLSearchParams({ page: String(page), limit: String(limit), sort });
    if (department) params.set('department', department);
    if (course) params.set('course', course);
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

export const getTeacherDetail = (
    id: number,
    reviewPage: number = 1,
    reviewLimit: number = 50,
    query?: { sort?: 'newest' | 'helpful'; course?: string | null }
) => {
    const params = new URLSearchParams({ review_page: String(reviewPage), review_limit: String(reviewLimit) });
    if (query?.sort === 'helpful') params.set('review_sort', 'helpful');
    if (query?.course) params.set('review_course', query.course);
    return api.get(`/teachers/${id}?${params.toString()}`);
};

/** AI summary (Roman Urdu) of a teacher's approved reviews. */
export const getTeacherSummary = (id: number) => {
    return api.get(`/teachers/${id}/summary`);
};

/** Mark / unmark a review as helpful (one vote per browser). */
export const voteHelpful = (reviewId: number, helpful: boolean) => {
    return helpful
        ? api.post(`/reviews/${reviewId}/helpful`, {})
        : api.delete(`/reviews/${reviewId}/helpful`);
};

/** Anonymous usage counters; failures are irrelevant to the visitor. */
export const trackEvent = (event: { type: 'visit' } | { type: 'teacher_view'; teacher_id: number }) => {
    return api.post('/track', event).catch(() => undefined);
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

// Reply to a published review. Replies are moderated before they appear.
// ========== ANALYTICS & ERRORS (admin) ==========

export const getAdminAnalytics = (days: 7 | 30 | 90) => {
    return api.get(`/admin/analytics?days=${days}`);
};

export const getAdminErrors = (status: 'open' | 'resolved' = 'open', page: number = 1) => {
    return api.get(`/admin/errors?status=${status}&page=${page}`);
};

export const setAdminErrorResolved = (id: number, resolved: boolean) => {
    return api.put(`/admin/errors/${id}`, { resolved });
};

export const deleteAdminError = (id: number) => {
    return api.delete(`/admin/errors/${id}`);
};

export const resolveAllAdminErrors = () => {
    return api.post('/admin/errors/resolve-all', {});
};

export const bulkModerateReplies = (ids: number[], action: 'approve' | 'hide' | 'delete') => {
    return api.post('/admin/replies/bulk', { ids, action });
};

export const replyToReview = (reviewId: number, reply: string, userName?: string) => {
    return api.post(`/reviews/${reviewId}/replies`, { reply, user_name: userName || undefined });
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

export const adminLogin = (username: string, password: string, totp_code?: string) => {
    return api.post('/admin/login', { username, password, totp_code });
};

export const adminMe = async () => {
    const res = await api.get('/admin/me');
    // Backward-compatible shape; older backends return admin without totp_enabled.
    return { admin: res.data.admin } as { admin: { id: number; username: string; totp_enabled?: number } };
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

// ========== REVIEW REPLIES (admin) ==========

export type ReplyStatusFilter = 'pending' | 'approved';

export const getAdminReplies = (page: number = 1, limit: number = 50, status: ReplyStatusFilter = 'pending') => {
    return api.get(`/admin/replies?page=${page}&limit=${limit}&status=${status}`);
};

export const updateReply = (id: number, data: { reply?: string; user_name?: string; is_approved?: boolean }) => {
    return api.put(`/admin/replies/${id}`, data);
};

export const deleteReply = (id: number) => {
    return api.delete(`/admin/replies/${id}`);
};

export const getAdminStats = () => {
    return api.get('/admin/stats');
};

/** Paginated admin audit trail; pass an action name to filter. */
export const getAdminAuditLogs = (page: number = 1, limit: number = 25, action: string = '') => {
    return api.get(`/admin/audit-logs?page=${page}&limit=${limit}${action ? `&action=${encodeURIComponent(action)}` : ''}`);
};

/** Teacher search terms that returned zero results (content-gap signals). */
export const getSearchGaps = () => {
    return api.get('/admin/search-gaps');
};

// ========== ADMIN TWO-FACTOR (RFC 6238 TOTP) ==========

export interface Admin2faProvision {
    secret: string;
    otpauth_uri: string;
}

export const getAdmin2faProvision = () => {
    return api.post<{ secret: string; otpauth_uri: string }>('/admin/2fa/setup', {});
};

export const confirmAdmin2fa = (code: string) => {
    return api.post('/admin/2fa/enable', { code });
};

export const disableAdmin2fa = () => {
    return api.post('/admin/2fa/disable', {});
};

/**
 * Clear teacher photo URLs that aren't real images (e.g. a bare directory URL
 * with no filename). Pass dryRun to preview without changing anything.
 */
export const cleanTeacherImages = (dryRun: boolean = false) => {
    return api.post(`/admin/clean-teacher-images?dryRun=${dryRun ? 'true' : 'false'}`, {});
};

export default api;

// ========== CHAT ASSISTANT ==========

export interface ChatTeacherRef {
    id: number;
    name: string;
    department: string;
}

export interface ChatReply {
    reply: string;
    teachers: ChatTeacherRef[];
    /** Signed by the server; needed to rate this answer. */
    replyToken?: string;
}

/** Whether the assistant is switched on (the server has a Gemini key). */
export const getChatStatus = () => api.get<{ enabled: boolean }>('/chat/status', { timeout: 15000 });

/** Ask the assistant. `history` is the visible conversation so far (oldest first). */
export const sendChatMessage = (data: {
    message: string;
    history: { role: 'user' | 'assistant'; text: string }[];
    teacherId?: number | null;
}) => api.post<ChatReply>('/chat', data, { timeout: 45000 });

/** 👍 (1) or 👎 (-1) for one answer. Sends that question and answer to the admins. */
export const sendChatFeedback = (data: {
    token: string;
    question: string;
    answer: string;
    teacherIds: number[];
    rating: 1 | -1;
    comment?: string;
}) => api.post<{ success: boolean }>('/chat/feedback', data, { timeout: 20000 });

export interface ChatInsightsFeedback {
    id: number;
    rating: 1 | -1;
    question: string;
    answer: string;
    comment: string | null;
    created_at: string;
    updated_at: string;
    teachers: { id: number; name: string }[];
}

export interface ChatInsights {
    available: boolean;
    days: number;
    requests?: Record<string, number>;
    byDay?: { day: string; questions: number }[];
    modes?: Record<string, number>;
    languages?: Record<string, number>;
    aspects?: Record<string, number>;
    models?: Record<string, number>;
    topTeachers?: { id: number; name: string; department: string; count: number }[];
    topTopics?: { name: string; count: number }[];
    ratings?: { up: number; down: number };
    feedback?: ChatInsightsFeedback[];
}

export const getChatInsights = (days: 7 | 30 | 90 = 30) => api.get<ChatInsights>(`/admin/chat/insights?days=${days}`);

export const deleteChatFeedback = (id: number) => api.delete(`/admin/chat/feedback/${id}`);
