import axios from 'axios';

const API_BASE = 'https://teacher-review-system.onrender.com/api';

const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000, // 60 seconds for cold start
});

// Add token to requests if exists
api.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('admin_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error) => Promise.reject(error)
);

// ========== PUBLIC APIs ==========

/**
 * Get teachers with pagination (20 per page)
 */
export const getTeachers = (page: number = 1) => {
    return api.get(`/teachers?page=${page}&limit=20`);
};

/**
 * Search all teachers (no pagination) – returns all matches
 */
export const searchAllTeachers = (query: string) => {
    if (!query || query.trim() === '') {
        return Promise.resolve({ data: [] });
    }
    return api.get(`/teachers/search?q=${encodeURIComponent(query)}`);
};

/**
 * Get single teacher details + reviews
 */
export const getTeacherDetail = (id: number) => {
    return api.get(`/teachers/${id}`);
};

/**
 * Submit a new review
 */
export const submitReview = (data: { 
    teacher_id: number; 
    rating: number; 
    comment: string; 
    user_name?: string;
}) => {
    const teacherId = Number(data.teacher_id);
    if (isNaN(teacherId) || teacherId <= 0) {
        return Promise.reject({ response: { data: { error: 'Invalid teacher ID' } } });
    }
    const reviewData = {
        teacher_id: teacherId,
        rating: Number(data.rating),
        comment: data.comment,
        user_name: data.user_name || 'Anonymous'
    };
    return api.post('/reviews', reviewData);
};

// ========== ADMIN APIs ==========

/**
 * Admin login
 */
export const adminLogin = (username: string, password: string) => {
    return api.post('/admin/login', { username, password });
};

/**
 * Add a new teacher
 */
export const addTeacher = (data: { name: string; department: string; image_url?: string }) => {
    return api.post('/admin/teachers', data);
};

/**
 * Delete a teacher (and all their reviews)
 */
export const deleteTeacher = (id: number) => {
    return api.delete(`/admin/teachers/${id}`);
};

/**
 * Get all reviews for admin moderation
 */
export const getAdminReviews = () => {
    return api.get('/admin/reviews');
};

/**
 * Delete a review
 */
export const deleteReview = (id: number) => {
    return api.delete(`/admin/reviews/${id}`);
};

/**
 * Get admin dashboard statistics
 */
export const getAdminStats = () => {
    return api.get('/admin/stats');
};

export default api;