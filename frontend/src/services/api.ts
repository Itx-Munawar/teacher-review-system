import axios from 'axios';

const API_BASE = 'https://teacher-review-system.onrender.com/api';

const api = axios.create({
    baseURL: API_BASE,
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
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
    (error) => {
        return Promise.reject(error);
    }
);

// ========== PUBLIC APIs ==========

/**
 * Get all teachers with average ratings
 */
export const getTeachers = () => {
    console.log('📚 Fetching all teachers...');
    return api.get('/teachers');
};

/**
 * Get single teacher details with all reviews
 */
export const getTeacherDetail = (id: number) => {
    console.log(`📚 Fetching teacher details for ID: ${id}`);
    return api.get(`/teachers/${id}`);
};

/**
 * Submit a new review (no login required)
 */
export const submitReview = (data: { 
    teacher_id: number; 
    rating: number; 
    comment: string; 
    user_name?: string;
}) => {
    // Ensure teacher_id is a valid number
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
    
    console.log('✏️ Submitting review:', reviewData);
    return api.post('/reviews', reviewData);
};

/**
 * Search teachers by name (typeahead)
 */
export const searchTeachers = (query: string) => {
    console.log(`🔍 Searching teachers with query: ${query}`);
    return api.get(`/search/teachers?q=${query}`);
};

/**
 * Health check endpoint
 */
export const healthCheck = () => {
    console.log('🏥 Health check...');
    return api.get('/health');
};

// ========== ADMIN APIs (require authentication) ==========

/**
 * Admin login
 */
export const adminLogin = (username: string, password: string) => {
    console.log(`🔐 Admin login attempt: ${username}`);
    return api.post('/admin/login', { username, password });
};

/**
 * Add a new teacher (admin only)
 */
export const addTeacher = (data: { name: string; department: string }) => {
    console.log('➕ Adding new teacher:', data);
    return api.post('/admin/teachers', data);
};

/**
 * Update an existing teacher (admin only)
 */
export const updateTeacher = (id: number, data: { name: string; department: string }) => {
    console.log(`✏️ Updating teacher ID ${id}:`, data);
    return api.put(`/admin/teachers/${id}`, data);
};

/**
 * Delete a teacher (admin only)
 * This will also delete all reviews for this teacher
 */
export const deleteTeacher = (id: number) => {
    console.log(`🗑️ Deleting teacher ID: ${id}`);
    return api.delete(`/admin/teachers/${id}`);
};

/**
 * Get all reviews for moderation (admin only)
 */
export const getAdminReviews = () => {
    console.log('📋 Fetching all reviews for admin...');
    return api.get('/admin/reviews');
};

/**
 * Delete a review (admin only)
 */
export const deleteReview = (id: number) => {
    console.log(`🗑️ Deleting review ID: ${id}`);
    return api.delete(`/admin/reviews/${id}`);
};

/**
 * Get admin dashboard statistics (admin only)
 */
export const getAdminStats = () => {
    console.log('📊 Fetching admin statistics...');
    return api.get('/admin/stats');
};

/**
 * Get all teachers for admin panel (admin only)
 */
export const getAdminTeachers = () => {
    console.log('📚 Fetching all teachers for admin...');
    return api.get('/admin/teachers');
};

// ========== Helper Functions ==========

/**
 * Check if user is logged in as admin
 */
export const isAdminLoggedIn = (): boolean => {
    const token = localStorage.getItem('admin_token');
    return !!token;
};

/**
 * Get admin token
 */
export const getAdminToken = (): string | null => {
    return localStorage.getItem('admin_token');
};

/**
 * Logout admin (remove token)
 */
export const adminLogout = (): void => {
    console.log('🚪 Admin logging out...');
    localStorage.removeItem('admin_token');
};

/**
 * Set admin token (used after login)
 */
export const setAdminToken = (token: string): void => {
    console.log('🔑 Setting admin token');
    localStorage.setItem('admin_token', token);
};

export default api;