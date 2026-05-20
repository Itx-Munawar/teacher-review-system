import React, { useState, useEffect, useCallback, memo } from 'react';
import { 
    getTeachers, 
    getTeacherDetail, 
    adminLogin, 
    addTeacher, 
    deleteTeacher, 
    deleteReview, 
    getAdminReviews, 
    submitReview,
    getAdminStats 
} from './services/api';
import ForgotPassword from './components/ForgotPassword';
import ResetPassword from './components/ResetPassword';
import './App.css';

// ========== LOCAL INTERFACES (UPDATED) ==========
interface Teacher {
    id: number;
    name: string;
    department: string;
    avg_rating: number;
    review_count: number;
    created_at?: string;
    image_url?: string;
}

interface Review {
    id: number;
    teacher_id: number;
    rating: number;
    comment: string;
    user_name: string;
    created_at: string;
}

interface TeacherDetail extends Teacher {
    reviews: Review[];
    total_reviews: number;
}

// ========== ADMIN PANEL COMPONENT (memoized) ==========
const AdminPanel = memo(({ 
    teachers, 
    reviewsForModeration, 
    adminStats,
    onAddTeacher, 
    onDeleteTeacher, 
    onDeleteReview, 
    onLogout,
    showAddTeacherForm,
    setShowAddTeacherForm,
    newTeacherName,
    setNewTeacherName,
    newTeacherDepartment,
    setNewTeacherDepartment
}: any) => {
    const renderStars = (rating: number) => {
        const numRating = Number(rating) || 0;
        const fullStars = Math.floor(numRating);
        const emptyStars = 5 - fullStars;
        return '⭐'.repeat(fullStars) + '☆'.repeat(emptyStars);
    };

    return (
        <div className="admin-panel">
            <div className="admin-header">
                <h2>Admin Dashboard</h2>
                <div className="admin-stats">
                    <span>📚 {Number(adminStats.total_teachers) || teachers.length} Teachers</span>
                    <span>💬 {Number(adminStats.total_reviews) || reviewsForModeration.length} Reviews</span>
                    <span>⭐ {Number(adminStats.average_rating || 0).toFixed(1)} Avg</span>
                </div>
                <button onClick={onLogout} className="logout-btn">Logout</button>
            </div>
            
            <div className="admin-section">
                <button onClick={() => setShowAddTeacherForm(!showAddTeacherForm)} className="add-teacher-btn">
                    {showAddTeacherForm ? 'Cancel' : '+ Add New Teacher'}
                </button>
                
                {showAddTeacherForm && (
                    <form onSubmit={onAddTeacher} className="add-teacher-form">
                        <input
                            type="text"
                            placeholder="Teacher Name"
                            value={newTeacherName}
                            onChange={(e) => setNewTeacherName(e.target.value)}
                            required
                            autoFocus
                        />
                        <input
                            type="text"
                            placeholder="Department"
                            value={newTeacherDepartment}
                            onChange={(e) => setNewTeacherDepartment(e.target.value)}
                            required
                        />
                        <button type="submit">Save Teacher</button>
                    </form>
                )}
            </div>
            
            <div className="admin-section">
                <h3>Manage Teachers ({teachers.length})</h3>
                <div className="admin-list">
                    {teachers.map((teacher: Teacher) => (
                        <div key={teacher.id} className="admin-item">
                            <span><strong>{teacher.name}</strong> - {teacher.department}</span>
                            <button onClick={() => onDeleteTeacher(teacher.id)} className="delete-btn">Delete</button>
                        </div>
                    ))}
                </div>
            </div>
            
            <div className="admin-section">
                <h3>Manage Reviews ({reviewsForModeration.length})</h3>
                <div className="admin-list">
                    {reviewsForModeration.length === 0 ? (
                        <p style={{textAlign: 'center', padding: '20px', color: '#999'}}>
                            📭 No reviews yet.
                        </p>
                    ) : (
                        reviewsForModeration.map((review: any) => (
                            <div key={review.id} className="admin-item">
                                <div className="review-info">
                                    <strong>{review.teacher_name}</strong>
                                    <span style={{marginLeft: '10px'}}>{renderStars(review.rating)}</span>
                                    <p style={{marginTop: '8px', marginBottom: '5px'}}>"{review.comment}"</p>
                                    <small>
                                        👤 {review.user_name || 'Anonymous'} | 
                                        📅 {new Date(review.created_at).toLocaleDateString()}
                                    </small>
                                </div>
                                <button onClick={() => onDeleteReview(review.id)} className="delete-btn">Delete</button>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
});

// ========== LOGIN FORM COMPONENT (memoized) ==========
const LoginForm = memo(({ 
    adminUsername, 
    setAdminUsername, 
    adminPassword, 
    setAdminPassword, 
    adminError, 
    onLogin 
}: any) => (
    <div className="login-form-container">
        <div className="login-form">
            <h2>Admin Login</h2>
            <form onSubmit={onLogin}>
                <input
                    type="text"
                    placeholder="Username"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    required
                    autoFocus
                />
                <input
                    type="password"
                    placeholder="Password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    required
                />
                {adminError && <div className="error-message">{adminError}</div>}
                <button type="submit">Login</button>
            </form>
            <p style={{textAlign: 'center', marginTop: '15px', fontSize: '12px', color: '#999'}}>
                Default: admin / Admin@123
            </p>
            <p style={{textAlign: 'center', marginTop: '15px'}}>
                <a href="/forgot-password" style={{color: '#667eea'}}>Forgot Password?</a>
            </p>
        </div>
    </div>
));

// ========== MAIN APP COMPONENT ==========
const App: React.FC = () => {
    // ALL useState hooks first
    const [teachers, setTeachers] = useState<Teacher[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedTeacher, setSelectedTeacher] = useState<TeacherDetail | null>(null);
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedTerm, setDebouncedTerm] = useState('');
    
    const [reviewRating, setReviewRating] = useState(5);
    const [reviewComment, setReviewComment] = useState('');
    const [reviewUserName, setReviewUserName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [reviewError, setReviewError] = useState('');
    
    const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(false);
    const [showAdminPanel, setShowAdminPanel] = useState(false);
    const [adminUsername, setAdminUsername] = useState('');
    const [adminPassword, setAdminPassword] = useState('');
    const [adminError, setAdminError] = useState('');
    const [showAddTeacherForm, setShowAddTeacherForm] = useState(false);
    const [newTeacherName, setNewTeacherName] = useState('');
    const [newTeacherDepartment, setNewTeacherDepartment] = useState('');
    const [reviewsForModeration, setReviewsForModeration] = useState<any[]>([]);
    const [adminStats, setAdminStats] = useState<any>({});

    // Debounce effect – updates debouncedTerm 300ms after searchTerm stops changing
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedTerm(searchTerm), 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    // ALL useEffect and useCallback hooks next
    useEffect(() => {
        loadTeachers();
        checkAdminLogin();
    }, []);

    const checkAdminLogin = () => {
        const token = localStorage.getItem('admin_token');
        if (token) {
            setIsAdminLoggedIn(true);
        }
    };

    const loadTeachers = async () => {
        try {
            setLoading(true);
            const response = await getTeachers();
            let teachersData = response.data;
            
            if (teachersData && teachersData.teachers) {
                teachersData = teachersData.teachers;
            }
            if (Array.isArray(teachersData)) {
                setTeachers(teachersData);
            } else {
                setTeachers([]);
            }
        } catch (error) {
            console.error('Error loading teachers:', error);
            setTeachers([]);
        } finally {
            setLoading(false);
        }
    };

    const loadAdminData = async () => {
        try {
            const reviewsRes = await getAdminReviews();
            const reviewsData = Array.isArray(reviewsRes.data) ? reviewsRes.data : [];
            console.log('✅ Admin reviews loaded:', reviewsData.length);
            setReviewsForModeration(reviewsData);
            
            const statsRes = await getAdminStats();
            setAdminStats(statsRes.data || {});
        } catch (error) {
            console.error('Error loading admin data:', error);
        }
    };

    const handleAdminLogin = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        setAdminError('');
        try {
            const response = await adminLogin(adminUsername, adminPassword);
            localStorage.setItem('admin_token', response.data.token);
            setIsAdminLoggedIn(true);
            setAdminUsername('');
            setAdminPassword('');
            alert('✅ Admin login successful!');
            await loadAdminData();
            await loadTeachers();
        } catch (error: any) {
            setAdminError(error.response?.data?.error || 'Login failed');
        }
    }, [adminUsername, adminPassword]);

    const handleAdminLogout = useCallback(() => {
        localStorage.removeItem('admin_token');
        setIsAdminLoggedIn(false);
        setShowAdminPanel(false);
        setShowAddTeacherForm(false);
        alert('Logged out successfully');
    }, []);

    const handleAddTeacher = useCallback(async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newTeacherName || !newTeacherDepartment) {
            alert('Please fill in all fields');
            return;
        }
        try {
            await addTeacher({ name: newTeacherName, department: newTeacherDepartment });
            alert('✅ Teacher added successfully!');
            setNewTeacherName('');
            setNewTeacherDepartment('');
            setShowAddTeacherForm(false);
            loadTeachers();
            await loadAdminData();
        } catch (error) {
            alert('Failed to add teacher');
        }
    }, [newTeacherName, newTeacherDepartment]);

    const handleDeleteTeacher = useCallback(async (id: number) => {
        if (window.confirm('Are you sure you want to delete this teacher? All reviews will also be deleted.')) {
            try {
                await deleteTeacher(id);
                alert('✅ Teacher deleted successfully!');
                loadTeachers();
                if (selectedTeacher?.id === id) {
                    setSelectedTeacher(null);
                    setShowReviewForm(false);
                }
                await loadAdminData();
            } catch (error) {
                alert('Failed to delete teacher');
            }
        }
    }, [selectedTeacher]);

    const handleDeleteReview = useCallback(async (id: number) => {
        if (window.confirm('Are you sure you want to delete this review?')) {
            try {
                await deleteReview(id);
                alert('✅ Review deleted successfully!');
                await loadAdminData();
                if (selectedTeacher) {
                    const response = await getTeacherDetail(selectedTeacher.id);
                    const data = response.data;
                    setSelectedTeacher({
                        id: data.id || selectedTeacher.id,
                        name: data.name || data.teacher?.name || selectedTeacher.name,
                        department: data.department || data.teacher?.department || selectedTeacher.department,
                        avg_rating: data.avg_rating || 0,
                        review_count: data.review_count || data.total_reviews || 0,
                        total_reviews: data.total_reviews || 0,
                        image_url: data.image_url || data.teacher?.image_url || null,
                        reviews: data.reviews || [],
                    });
                }
            } catch (error) {
                alert('Failed to delete review');
            }
        }
    }, [selectedTeacher]);

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
                rating: reviewRating,
                comment: reviewComment.trim(),
                user_name: reviewUserName.trim() || 'Anonymous'
            });
            alert('✅ Review submitted successfully!');
            setShowReviewForm(false);
            setReviewComment('');
            setReviewRating(5);
            setReviewUserName('');
            setReviewError('');
            
            const response = await getTeacherDetail(selectedTeacher.id);
            const data = response.data;
            setSelectedTeacher({
                id: data.id || selectedTeacher.id,
                name: data.name || data.teacher?.name || selectedTeacher.name,
                department: data.department || data.teacher?.department || selectedTeacher.department,
                avg_rating: data.avg_rating || 0,
                review_count: data.review_count || data.total_reviews || 0,
                total_reviews: data.total_reviews || 0,
                image_url: data.image_url || data.teacher?.image_url || null,
                reviews: data.reviews || [],
            });
            await loadTeachers();
            await loadAdminData();
        } catch (err: any) {
            console.error('Submit error:', err);
            setReviewError(err.response?.data?.error || 'Failed to submit review');
        } finally {
            setSubmitting(false);
        }
    }, [selectedTeacher, reviewRating, reviewComment, reviewUserName]);

    // Use debouncedTerm for filtering (search happens only after user stops typing)
    const filteredTeachers = teachers.filter((teacher: Teacher) =>
        teacher.name?.toLowerCase().includes(debouncedTerm.toLowerCase()) ||
        teacher.department?.toLowerCase().includes(debouncedTerm.toLowerCase())
    );

    const handleTeacherClick = useCallback(async (teacher: Teacher) => {
        console.log('Teacher clicked:', teacher);
        try {
            const response = await getTeacherDetail(teacher.id);
            const data = response.data;
            console.log('API response:', data);
            
            const teacherData: TeacherDetail = {
                id: data.id || teacher.id,
                name: data.name || data.teacher?.name || teacher.name,
                department: data.department || data.teacher?.department || teacher.department,
                avg_rating: Number(data.avg_rating) || 0,
                review_count: data.review_count || data.total_reviews || 0,
                total_reviews: data.total_reviews || 0,
                image_url: data.image_url || data.teacher?.image_url || null,
                reviews: data.reviews || [],
            };
            
            setSelectedTeacher(teacherData);
            setShowReviewForm(false);
            setReviewComment('');
            setReviewRating(5);
            setReviewUserName('');
            setReviewError('');
        } catch (error) {
            console.error('Error loading teacher details:', error);
        }
    }, []);

    const renderStars = (rating: number) => {
        const numRating = Number(rating) || 0;
        const fullStars = Math.floor(numRating);
        const emptyStars = 5 - fullStars;
        return '⭐'.repeat(fullStars) + '☆'.repeat(emptyStars);
    };

    // Show admin panel if admin is logged in and panel is open
    if (showAdminPanel) {
        if (!isAdminLoggedIn) {
            return (
                <div className="app">
                    <header className="header">
                        <h1>📚 Teacher Review System - Admin</h1>
                        <button onClick={() => setShowAdminPanel(false)} className="back-to-site-btn">← Back to Site</button>
                    </header>
                    <div className="container">
                        <LoginForm
                            adminUsername={adminUsername}
                            setAdminUsername={setAdminUsername}
                            adminPassword={adminPassword}
                            setAdminPassword={setAdminPassword}
                            adminError={adminError}
                            onLogin={handleAdminLogin}
                        />
                    </div>
                </div>
            );
        }
        return (
            <div className="app">
                <header className="header">
                    <h1>📚 Teacher Review System - Admin Panel</h1>
                    <button onClick={() => setShowAdminPanel(false)} className="back-to-site-btn">← Back to Site</button>
                </header>
                <div className="container">
                    <AdminPanel
                        teachers={teachers}
                        reviewsForModeration={reviewsForModeration}
                        adminStats={adminStats}
                        onAddTeacher={handleAddTeacher}
                        onDeleteTeacher={handleDeleteTeacher}
                        onDeleteReview={handleDeleteReview}
                        onLogout={handleAdminLogout}
                        showAddTeacherForm={showAddTeacherForm}
                        setShowAddTeacherForm={setShowAddTeacherForm}
                        newTeacherName={newTeacherName}
                        setNewTeacherName={setNewTeacherName}
                        newTeacherDepartment={newTeacherDepartment}
                        setNewTeacherDepartment={setNewTeacherDepartment}
                    />
                </div>
            </div>
        );
    }

    // ========== ROUTE CHECK ==========
    const pathname = window.location.pathname;
    if (pathname === '/forgot-password') {
        return <ForgotPassword />;
    }
    if (pathname === '/reset-password') {
        return <ResetPassword />;
    }

    // Main site view
    return (
        <div className="app">
            <header className="header">
                <h1>📚 Teacher Review System</h1>
                <p>Rate and review your professors anonymously</p>
                <button onClick={() => setShowAdminPanel(true)} className="admin-login-btn">
                    Admin Login
                </button>
            </header>

            <div className="container">
                <div className="sidebar">
                    <div className="search-box">
                        <input
                            type="text"
                            placeholder="🔍 Search by teacher name or department..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="search-input"
                        />
                    </div>
                    
                    <div className="teacher-list">
                        {loading ? (
                            <div className="loading">Loading teachers...</div>
                        ) : filteredTeachers.length === 0 ? (
                            <div className="no-results">No teachers found</div>
                        ) : (
                            filteredTeachers.map((teacher: Teacher) => (
                                <div 
                                    key={teacher.id} 
                                    className="teacher-card" 
                                    onClick={() => handleTeacherClick(teacher)}
                                >
                                    <h3>{teacher.name}</h3>
                                    <p className="department">{teacher.department}</p>
                                    <div className="rating">
                                        <span className="stars">{renderStars(teacher.avg_rating)}</span>
                                        <span className="reviews-count">({teacher.review_count} reviews)</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="main-content">
                    {selectedTeacher ? (
                        <div className="teacher-detail">
                            <button 
                                onClick={() => {
                                    setSelectedTeacher(null);
                                    setShowReviewForm(false);
                                }}
                                className="back-button"
                            >
                                ← Back to list
                            </button>
                            
                            {selectedTeacher.image_url && (
                                <img 
                                    src={selectedTeacher.image_url} 
                                    alt={selectedTeacher.name} 
                                    className="teacher-detail-image" 
                                />
                            )}
                            
                            <h1 className="teacher-name-heading">{selectedTeacher.name || 'Teacher'}</h1>
                            <p className="teacher-department">{selectedTeacher.department || ''}</p>
                            
                            <div className="rating-summary">
                                <div className="average-rating">
                                    <span className="stars">
                                        {renderStars(selectedTeacher.avg_rating)}
                                    </span>
                                    <span className="rating-number">
                                        {Number(selectedTeacher.avg_rating).toFixed(1)}/5
                                    </span>
                                </div>
                                <p>Based on {selectedTeacher.total_reviews || selectedTeacher.reviews?.length || 0} reviews</p>
                            </div>
                            
                            {!showReviewForm ? (
                                <button 
                                    onClick={() => {
                                        console.log('Write review button clicked');
                                        console.log('Selected teacher:', selectedTeacher);
                                        if (selectedTeacher && selectedTeacher.id) {
                                            setShowReviewForm(true);
                                        } else {
                                            setReviewError('Please select a teacher first');
                                        }
                                    }} 
                                    className="btn-write-review"
                                >
                                    ✏️ Write a Review for {selectedTeacher.name}
                                </button>
                            ) : (
                                <div className="review-form-container">
                                    <h3 className="review-form-title">✏️ Write a Review for {selectedTeacher.name}</h3>
                                    
                                    {reviewError && <div className="error-message">{reviewError}</div>}
                                    
                                    <form onSubmit={handleSubmitReview}>
                                        <div className="form-group">
                                            <label>⭐ Rating (1-5)</label>
                                            <select 
                                                value={reviewRating} 
                                                onChange={(e) => setReviewRating(Number(e.target.value))} 
                                                required
                                            >
                                                <option value="5">5 Stars - Excellent ⭐⭐⭐⭐⭐</option>
                                                <option value="4">4 Stars - Very Good ⭐⭐⭐⭐</option>
                                                <option value="3">3 Stars - Average ⭐⭐⭐</option>
                                                <option value="2">2 Stars - Poor ⭐⭐</option>
                                                <option value="1">1 Star - Very Poor ⭐</option>
                                            </select>
                                        </div>
                                        
                                        <div className="form-group">
                                            <label>👤 Your Name (optional)</label>
                                            <input 
                                                type="text" 
                                                value={reviewUserName} 
                                                onChange={(e) => setReviewUserName(e.target.value)} 
                                                placeholder="Leave blank to post anonymously"
                                            />
                                        </div>
                                        
                                        <div className="form-group">
                                            <label>💬 Your Review *</label>
                                            <textarea 
                                                rows={4} 
                                                value={reviewComment} 
                                                onChange={(e) => setReviewComment(e.target.value)} 
                                                placeholder="Share your experience with this teacher..."
                                                required
                                            />
                                        </div>
                                        
                                        <div className="form-buttons">
                                            <button type="button" onClick={() => setShowReviewForm(false)} className="btn-cancel">
                                                Cancel
                                            </button>
                                            <button type="submit" disabled={submitting} className="btn-submit">
                                                {submitting ? 'Submitting...' : 'Submit Review'}
                                            </button>
                                        </div>
                                    </form>
                                </div>
                            )}
                            
                            <div className="reviews-section">
                                <h3>📝 Student Reviews</h3>
                                {!selectedTeacher.reviews || selectedTeacher.reviews.length === 0 ? (
                                    <p>No reviews yet. Be the first to review!</p>
                                ) : (
                                    selectedTeacher.reviews.map((review: Review) => (
                                        <div key={review.id} className="review-card">
                                            <div className="review-header">
                                                <span className="reviewer-name">
                                                    👤 {review.user_name || 'Anonymous'}
                                                </span>
                                                <span className="review-rating">
                                                    {renderStars(review.rating)}
                                                </span>
                                                <span className="review-date">
                                                    📅 {new Date(review.created_at).toLocaleDateString()}
                                                </span>
                                            </div>
                                            <p className="review-comment">"{review.comment}"</p>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="welcome-message">
                            <h2>Welcome to Teacher Reviews</h2>
                            <p>👈 Select a teacher from the left to read reviews or submit your own.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default App;