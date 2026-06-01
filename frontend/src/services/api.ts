import axios from 'axios';

const API_BASE = 'https://teacher-review-system.onrender.com/api';

const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000, // 60 seconds for cold start
});

// ========== INTERCEPTORS ==========

// Request interceptor – add admin token to headers
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

// Response interceptor – handle 401/403 (session expired)
api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.response?.status === 401 || error.response?.status === 403) {
            localStorage.removeItem('admin_token');
            // Dispatch a custom event that App can listen to
            window.dispatchEvent(new CustomEvent('admin-session-expired'));
        }
        return Promise.reject(error);
    }
);

// ========== PUBLIC APIs ==========

export const getTeachers = (page: number = 1) => {
    return api.get(`/teachers?page=${page}&limit=20`);
};

export const searchAllTeachers = (query: string) => {
    if (!query || query.trim() === '') {
        return Promise.resolve({ data: [] });
    }
    return api.get(`/teachers/search?q=${encodeURIComponent(query)}`);
};

export const getTeacherDetail = (id: number) => {
    return api.get(`/teachers/${id}`);
};

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

export const adminLogin = (username: string, password: string) => {
    return api.post('/admin/login', { username, password });
};

export const addTeacher = (data: { name: string; department: string; image_url?: string }) => {
    return api.post('/admin/teachers', data);
};

export const deleteTeacher = (id: number) => {
    return api.delete(`/admin/teachers/${id}`);
};

export const getAdminReviews = () => {
    return api.get('/admin/reviews');
};

export const deleteReview = (id: number) => {
    return api.delete(`/admin/reviews/${id}`);
};

export const getAdminStats = () => {
    return api.get('/admin/stats');
};

export default api;