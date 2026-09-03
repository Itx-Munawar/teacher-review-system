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
    const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/[\.$?*|{}()\[\]\\]/g, '\\$&') + '=([^;]*)'));
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
        if (error.response?.status === 401 || error.response?.status === 403) {
            // Dispatch a custom event that App can listen to
            window.dispatchEvent(new CustomEvent('admin-session-expired'));
        }
        return Promise.reject(error);
    }
);

// ========== PUBLIC APIs ==========

export const getTeachers = (page: number = 1, sort: string = 'name', department?: string) => {
    const params = new URLSearchParams({ page: String(page), limit: '20', sort });
    if (department) params.set('department', department);
    return api.get(`/teachers?${params.toString()}`);
};

export const getDepartments = () => {
    return api.get('/departments');
};

export const getRelatedTeachers = (id: number) => {
    return api.get(`/teachers/${id}/related`);
};

export const searchAllTeachers = (query: string, limit?: number) => {
    if (!query || query.trim() === '') {
        return Promise.resolve({ data: [] });
    }
    const params = new URLSearchParams({ q: query });
    if (limit) params.set('limit', String(limit));
    return api.get(`/teachers/search?${params.toString()}`);
};

export const getTeacherDetail = (id: number) => {
    return api.get(`/teachers/${id}`);
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
    tags?: string[];
}) => {
    const teacherId = Number(data.teacher_id);
    if (isNaN(teacherId) || teacherId <= 0) {
        return Promise.reject({ response: { data: { error: 'Invalid teacher ID' } } });
    }
    const reviewData = {
        teacher_id: teacherId,
        comment: data.comment,
        user_name: data.user_name || 'Anonymous',
        tags: data.tags || []
    };
    return api.post('/reviews', reviewData);
};

export const getTeacherSummary = (id: number) => {
    return api.get(`/teachers/${id}/summary`);
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

export const getAdminReviews = (page: number = 1, limit: number = 50) => {
    return api.get(`/admin/reviews?page=${page}&limit=${limit}`);
};

export const deleteReview = (id: number) => {
    return api.delete(`/admin/reviews/${id}`);
};

export type { AdminQuestion } from '../types';

export const getAdminQuestions = (page: number = 1, limit: number = 50) => {
    return api.get(`/admin/questions?page=${page}&limit=${limit}`);
};

export const deleteQuestion = (id: number) => {
    return api.delete(`/admin/questions/${id}`);
};

export const getAdminStats = () => {
    return api.get('/admin/stats');
};

export default api;
