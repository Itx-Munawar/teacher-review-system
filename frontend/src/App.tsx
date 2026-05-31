import React, { useState, useEffect, useCallback, memo, useRef } from 'react';
import { 
    getTeachers, 
    searchAllTeachers,
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

// ========== INTERFACES ==========
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

// ========== ADMIN PANEL ==========
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
    setNewTeacherDepartment,
    newTeacherImage,
    setNewTeacherImage,
    totalTeachersCount,
    loadingMore,
    onLoadMore,
    // New search props
    adminSearchTerm,
    onAdminSearchChange,
    adminSearchResults,
    adminIsSearching
}: any) => {
    const renderStars = (rating: number) => {
        const numRating = Number(rating) || 0;
        const fullStars = Math.floor(numRating);
        const emptyStars = 5 - fullStars;
        return '⭐'.repeat(fullStars) + '☆'.repeat(emptyStars);
    };

    const totalReviews = reviewsForModeration?.length || 0;
    
    let avgRating = Number(adminStats.average_rating) || 0;
    if (avgRating === 0 && totalReviews > 0) {
        const totalRating = reviewsForModeration.reduce((sum: number, review: any) => sum + (Number(review.rating) || 0), 0);
        avgRating = totalRating / totalReviews;
    }

    // Determine which teachers to display
    const displayTeachers = adminSearchTerm ? adminSearchResults : teachers;
    const displayCount = adminSearchTerm ? adminSearchResults.length : teachers.length;
    const displayTotal = adminSearchTerm ? adminSearchResults.length : totalTeachersCount;

    return (
        <div className="admin-panel">
            <div className="admin-header">
                <h2>Admin Dashboard</h2>
                <div className="admin-stats">
                    <span>📚 {totalTeachersCount || teachers.length} Teachers</span>
                    <span>💬 {totalReviews} Reviews</span>
                    <span>⭐ {avgRating.toFixed(1)} Avg</span>
                </div>
                <button onClick={onLogout} className="logout-btn">Logout</button>
            </div>
            
            <div className="admin-section">
                <button onClick={() => setShowAddTeacherForm(!showAddTeacherForm)} className="add-teacher-btn">
                    {showAddTeacherForm ? 'Cancel' : '+ Add New Teacher'}
                </button>
                {showAddTeacherForm && (
                    <form onSubmit={onAddTeacher} className="add-teacher-form">
                        <input type="text" placeholder="Teacher Name" value={newTeacherName} onChange={(e) => setNewTeacherName(e.target.value)} required />
                        <input type="text" placeholder="Department" value={newTeacherDepartment} onChange={(e) => setNewTeacherDepartment(e.target.value)} required />
                        <input type="url" placeholder="Image URL (optional)" value={newTeacherImage} onChange={(e) => setNewTeacherImage(e.target.value)} />
                        <button type="submit">Save Teacher</button>
                    </form>
                )}
            </div>
            
            <div className="admin-section">
                <h3>Manage Teachers</h3>
                
                {/* Search input */}
                <div className="search-box" style={{ marginBottom: '1rem' }}>
                    <input
                        type="text"
                        placeholder="🔍 Search teachers by name or department..."
                        value={adminSearchTerm}
                        onChange={onAdminSearchChange}
                        className="search-input"
                    />
                    {adminSearchTerm && (
                        <div className="search-info">
                            Found {adminSearchResults.length} teacher{adminSearchResults.length !== 1 ? 's' : ''} matching "{adminSearchTerm}"
                        </div>
                    )}
                </div>

                <div className="admin-list">
                    {adminIsSearching ? (
                        <div className="loading">Searching...</div>
                    ) : displayTeachers.length === 0 ? (
                        <p style={{textAlign: 'center', padding: '20px', color: '#999'}}>
                            {adminSearchTerm ? 'No teachers found' : 'No teachers added yet'}
                        </p>
                    ) : (
                        displayTeachers.map((teacher: Teacher) => (
                            <div key={teacher.id} className="admin-item">
                                <span><strong>{teacher.name}</strong> - {teacher.department}</span>
                                <button onClick={() => onDeleteTeacher(teacher.id)} className="delete-btn">Delete</button>
                            </div>
                        ))
                    )}
                </div>

                {/* Load More – only when not searching */}
                {!adminSearchTerm && (
                    <>
                        {loadingMore && <div className="loading-more">Loading more teachers...</div>}
                        {!loadingMore && teachers.length < totalTeachersCount && (
                            <button onClick={onLoadMore} className="load-more-btn" style={{ marginTop: '1rem', width: '100%' }}>
                                Load More ({teachers.length} / {totalTeachersCount})
                            </button>
                        )}
                        {teachers.length === totalTeachersCount && totalTeachersCount > 0 && (
                            <div className="end-of-list">✨ You've seen all {totalTeachersCount} teachers</div>
                        )}
                    </>
                )}
            </div>
            
            <div className="admin-section">
                <h3>Manage Reviews ({totalReviews})</h3>
                <div className="admin-list">
                    {totalReviews === 0 ? (
                        <p style={{textAlign: 'center', padding: '20px', color: '#999'}}>📭 No reviews yet.</p>
                    ) : (
                        reviewsForModeration.map((review: any) => (
                            <div key={review.id} className="admin-item">
                                <div className="review-info">
                                    <strong>{review.teacher_name}</strong>
                                    <span style={{marginLeft: '10px'}}>{renderStars(review.rating)}</span>
                                    <p style={{marginTop: '8px', marginBottom: '5px'}}>"{review.comment}"</p>
                                    <small>👤 {review.user_name || 'Anonymous'} | 📅 {new Date(review.created_at).toLocaleDateString()}</small>
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

// ========== LOGIN FORM ==========
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

// ========== MAIN APP ==========
const App: React.FC = () => {
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
    const [showReviewForm, setShowReviewForm] = useState(false);
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
    const [newTeacherImage, setNewTeacherImage] = useState('');
    const [reviewsForModeration, setReviewsForModeration] = useState<any[]>([]);
    const [adminStats, setAdminStats] = useState<any>({});

    const loadMoreRef = useRef<HTMLDivElement>(null);
    const [showAboutModal, setShowAboutModal] = useState(false);
    const [showContactModal, setShowContactModal] = useState(false);
    // Admin panel search state
const [adminSearchTerm, setAdminSearchTerm] = useState('');
const [adminSearchResults, setAdminSearchResults] = useState<Teacher[]>([]);
const [adminIsSearching, setAdminIsSearching] = useState(false);

    // ========== TEACHER LOADING (PAGINATED) ==========
    const loadTeachers = useCallback(async (page: number = 1, retryCount: number = 0) => {
        try {
            if (page === 1) setLoading(true);
            else setLoadingMore(true);
            setError(null);

            const response = await getTeachers(page);
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
        } catch (err: any) {
            console.error('Failed to load teachers:', err);
            if (retryCount === 0 && (err.code === 'ECONNABORTED' || err.message?.includes('timeout'))) {
                console.log('Auto-retrying after timeout...');
                setTimeout(() => loadTeachers(page, 1), 2000);
                return;
            }
            setError('Failed to load teachers. Please refresh the page.');
        } finally {
            if (page === 1) setLoading(false);
            else setLoadingMore(false);
        }
    }, []);

    // ========== SEARCH (ALL TEACHERS) ==========
    const handleSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setSearchTerm(value);
        
        if (value.trim()) {
            setIsSearching(true);
            setLoading(true);
            try {
                const res = await searchAllTeachers(value);
                setSearchResults(res.data || []);
            } catch (error) {
                console.error('Search error:', error);
                setSearchResults([]);
            } finally {
                setLoading(false);
            }
        } else {
            setIsSearching(false);
            setSearchResults([]);
            setCurrentPage(1);
            loadTeachers(1);
        }
    };

    // Admin panel search (search all teachers without pagination)
    const handleAdminSearch = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setAdminSearchTerm(value);
    
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
};

    // Load next page when currentPage changes (only if not searching)
    useEffect(() => {
        if (!isSearching && currentPage > 1) {
            loadTeachers(currentPage);
        }
    }, [currentPage, isSearching, loadTeachers]);

    // Initial load
    useEffect(() => {
        loadTeachers(1);
        checkAdminLogin();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const checkAdminLogin = () => {
        const token = localStorage.getItem('admin_token');
        if (token) setIsAdminLoggedIn(true);
    };

    // ========== ADMIN DATA ==========
    const loadAdminData = useCallback(async () => {
        try {
            const reviewsRes = await getAdminReviews();
            let reviewsData = [];
            if (reviewsRes.data) {
                if (Array.isArray(reviewsRes.data)) reviewsData = reviewsRes.data;
                else if (reviewsRes.data.reviews) reviewsData = reviewsRes.data.reviews;
                else if (reviewsRes.data.data) reviewsData = reviewsRes.data.data;
            }
            setReviewsForModeration(reviewsData);
            
            const statsRes = await getAdminStats();
            const stats = statsRes.data || {};
            setAdminStats({
                total_teachers: stats.total_teachers || 0,
                total_reviews: reviewsData.length,
                average_rating: stats.average_rating || 0
            });
        } catch (error) {
            console.error('Error loading admin data:', error);
        }
    }, []);

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
            await loadTeachers(1);
        } catch (error: any) {
            setAdminError(error.response?.data?.error || 'Login failed');
        }
    }, [adminUsername, adminPassword, loadAdminData, loadTeachers]);

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
            await addTeacher({ 
                name: newTeacherName, 
                department: newTeacherDepartment,
                image_url: newTeacherImage || undefined
            });
            alert('✅ Teacher added successfully!');
            setNewTeacherName('');
            setNewTeacherDepartment('');
            setNewTeacherImage('');
            setShowAddTeacherForm(false);
            loadTeachers(1);
            await loadAdminData();
        } catch (error) {
            alert('Failed to add teacher');
        }
    }, [newTeacherName, newTeacherDepartment, newTeacherImage, loadTeachers, loadAdminData]);

    const handleDeleteTeacher = useCallback(async (id: number) => {
        if (window.confirm('Are you sure you want to delete this teacher? All reviews will also be deleted.')) {
            try {
                await deleteTeacher(id);
                alert('✅ Teacher deleted successfully!');
                loadTeachers(1);
                if (selectedTeacher?.id === id) {
                    setSelectedTeacher(null);
                    setShowReviewForm(false);
                }
                await loadAdminData();
            } catch (error) {
                alert('Failed to delete teacher');
            }
        }
    }, [selectedTeacher, loadTeachers, loadAdminData]);

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
    }, [selectedTeacher, loadAdminData]);

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
            await loadTeachers(1);
            await loadAdminData();
        } catch (err: any) {
            console.error('Submit error:', err);
            setReviewError(err.response?.data?.error || 'Failed to submit review');
        } finally {
            setSubmitting(false);
        }
    }, [selectedTeacher, reviewRating, reviewComment, reviewUserName, loadTeachers, loadAdminData]);

    const handleTeacherClick = useCallback(async (teacher: Teacher) => {
        try {
            const response = await getTeacherDetail(teacher.id);
            const data = response.data;
            const teacherInfo = data.teacher;
            const reviewsList = data.reviews || [];
            const avgRating = Number(data.avg_rating) || 0;
            const totalReviews = data.total_reviews || 0;

            const teacherData: TeacherDetail = {
                id: teacherInfo.id,
                name: teacherInfo.name,
                department: teacherInfo.department,
                avg_rating: avgRating,
                review_count: totalReviews,
                total_reviews: totalReviews,
                image_url: teacherInfo.image_url || null,
                reviews: reviewsList,
            };
            setSelectedTeacher(teacherData);
            setShowReviewForm(false);
            setReviewComment('');
            setReviewRating(5);
            setReviewUserName('');
            setReviewError('');
        } catch (error) {
            console.error('Error loading teacher details:', error);
            alert('Failed to load teacher details');
        }
    }, []);

    const renderStars = (rating: number) => {
        const numRating = Number(rating) || 0;
        const fullStars = Math.floor(numRating);
        const emptyStars = 5 - fullStars;
        return '⭐'.repeat(fullStars) + '☆'.repeat(emptyStars);
    };

    const displayTeachers = isSearching ? searchResults : teachers;

    const loadMore = () => {
        if (!isSearching && hasMore && !loadingMore) {
            setCurrentPage(prev => prev + 1);
        }
    };

    // ========== RENDER ==========
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
    newTeacherImage={newTeacherImage}
    setNewTeacherImage={setNewTeacherImage}
    totalTeachersCount={totalTeachersCount}
    loadingMore={loadingMore}
    onLoadMore={() => setCurrentPage(prev => prev + 1)}
    adminSearchTerm={adminSearchTerm}
onAdminSearchChange={handleAdminSearch}
adminSearchResults={adminSearchResults}
adminIsSearching={adminIsSearching}
/>
                </div>
            </div>
        );
    }

    const pathname = window.location.pathname;
    if (pathname === '/forgot-password') return <ForgotPassword />;
    if (pathname === '/reset-password') return <ResetPassword />;

    return (
        <div className="app">
            <header className="header">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '15px', flexWrap: 'wrap' }}>
          <img 
            src="https://www.umt.edu.pk/images/umt-logo.png" 
            alt="UMT Logo" 
            style={{ height: '60px', width: 'auto' }}
           />
             <h1 style={{ margin: 0 }}>UMT Teacher Reviews</h1>
             </div>
            <p>Rate and review your professors anonymously</p>
           <div style={{ display: 'flex', gap: '15px', justifyContent: 'center', flexWrap: 'wrap' }}>
    <button onClick={() => setShowAdminPanel(true)} className="admin-login-btn">
        🔒 Admin Login
    </button>
    <button 
        onClick={() => setShowContactModal(true)}
        className="admin-login-btn"
    >
        📧 Contact Us
    </button>
    <button 
        onClick={() => setShowAboutModal(true)}
        className="admin-login-btn"
    >
        ℹ️ About
    </button>
</div>
             </header>

             <div className="container">
                <div className="sidebar">
                    <div className="search-box">
                        <input
                            type="text"
                            placeholder="🔍 Search by teacher name or department..."
                            value={searchTerm}
                            onChange={handleSearch}
                            className="search-input"
                        />
                        {isSearching && searchTerm && (
                            <div className="search-info">
                                Found {searchResults.length} teacher{searchResults.length !== 1 ? 's' : ''} matching "{searchTerm}"
                            </div>
                        )}
                    </div>
                    
                    <div className="teacher-list">
                        {loading ? (
                            <div className="loading">Loading teachers...</div>
                        ) : error ? (
                            <div className="error-message">
                                {error} <button onClick={() => loadTeachers(1)}>Retry</button>
                            </div>
                        ) : displayTeachers.length === 0 ? (
                            <div className="no-results">No teachers found</div>
                        ) : (
                            <>
                                {displayTeachers.map((teacher: Teacher) => (
                                    <div 
                                        key={teacher.id} 
                                        className="teacher-card" 
                                        onClick={() => handleTeacherClick(teacher)}
                                    >
                                        {teacher.image_url && (
                                            <div className="teacher-card-image">
                                                <img src={teacher.image_url} alt={teacher.name} />
                                            </div>
                                        )}
                                        <div className="teacher-card-info">
                                            <h3>{teacher.name}</h3>
                                            <p className="department">{teacher.department}</p>
                                            <div className="rating">
                                                <span className="stars">{renderStars(teacher.avg_rating)}</span>
                                                <span className="reviews-count">({teacher.review_count} reviews)</span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                                {loadingMore && <div className="loading-more">Loading more teachers...</div>}
                                {!isSearching && hasMore && !loadingMore && (
                                    <div ref={loadMoreRef} className="load-more-container">
                                        <button onClick={loadMore} className="load-more-btn">
                                            Load More ({teachers.length} / {totalTeachersCount})
                                        </button>
                                    </div>
                                )}
                                {!isSearching && !hasMore && teachers.length > 0 && (
                                    <div className="end-of-list">✨ You've seen all {totalTeachersCount} teachers</div>
                                )}
                            </>
                        )}
                    </div>
                </div>

                <div className="main-content">
                    {selectedTeacher ? (
                        <div className="teacher-detail">
                            <button onClick={() => { setSelectedTeacher(null); setShowReviewForm(false); }} className="back-button">
                                ← Back to list
                            </button>
                            
                            {selectedTeacher.image_url && (
                                <img src={selectedTeacher.image_url} alt={selectedTeacher.name} className="teacher-detail-image" />
                            )}
                            
                            <h1 className="teacher-name-heading">{selectedTeacher.name || 'Teacher'}</h1>
                            <p className="teacher-department">{selectedTeacher.department || ''}</p>
                            
                            <div className="rating-summary">
                                <div className="average-rating">
                                    <span className="stars">{renderStars(selectedTeacher.avg_rating)}</span>
                                    <span className="rating-number">{Number(selectedTeacher.avg_rating).toFixed(1)}/5</span>
                                </div>
                                <p>Based on {selectedTeacher.total_reviews || selectedTeacher.reviews?.length || 0} reviews</p>
                            </div>
                            
                            {!showReviewForm ? (
                                <button onClick={() => { if (selectedTeacher && selectedTeacher.id) setShowReviewForm(true); else setReviewError('Please select a teacher first'); }} className="btn-write-review">
                                    ✏️ Write a Review for {selectedTeacher.name}
                                </button>
                            ) : (
                                <div className="review-form-container">
                                    <h3 className="review-form-title">✏️ Write a Review for {selectedTeacher.name}</h3>
                                    {reviewError && <div className="error-message">{reviewError}</div>}
                                    <form onSubmit={handleSubmitReview}>
                                        <div className="form-group">
                                            <label>⭐ Rating (1-5)</label>
                                            <select value={reviewRating} onChange={(e) => setReviewRating(Number(e.target.value))} required>
                                                <option value="5">5 Stars - Excellent ⭐⭐⭐⭐⭐</option>
                                                <option value="4">4 Stars - Very Good ⭐⭐⭐⭐</option>
                                                <option value="3">3 Stars - Average ⭐⭐⭐</option>
                                                <option value="2">2 Stars - Poor ⭐⭐</option>
                                                <option value="1">1 Star - Very Poor ⭐</option>
                                            </select>
                                        </div>
                                        <div className="form-group">
                                            <label>👤 Your Name (optional)</label>
                                            <input type="text" value={reviewUserName} onChange={(e) => setReviewUserName(e.target.value)} placeholder="Leave blank to post anonymously" />
                                        </div>
                                        <div className="form-group">
                                            <label>💬 Your Review *</label>
                                            <textarea rows={4} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="Share your experience with this teacher..." required />
                                        </div>
                                        <div className="form-buttons">
                                            <button type="button" onClick={() => setShowReviewForm(false)} className="btn-cancel">Cancel</button>
                                            <button type="submit" disabled={submitting} className="btn-submit">{submitting ? 'Submitting...' : 'Submit Review'}</button>
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
                                                <span className="reviewer-name">👤 {review.user_name || 'Anonymous'}</span>
                                                <span className="review-rating">{renderStars(review.rating)}</span>
                                                <span className="review-date">📅 {new Date(review.created_at).toLocaleDateString()}</span>
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
            {/* About Modal */}
{/* About Modal */}
{showAboutModal && (
    <div className="modal-overlay" onClick={() => setShowAboutModal(false)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>📖 About UMT Teacher Reviews</h3>
            <p>This platform allows students to rate and review their teachers anonymously.</p>
            <hr />
            <p><strong>👨‍💻 Developer:</strong> Munawar Hussain</p>
            <p><strong>🙏 Supporters & Contributors:</strong></p>
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
{/* Contact Modal */}
{showContactModal && (
    <div className="modal-overlay" onClick={() => setShowContactModal(false)}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>📧 Contact Us</h3>
            <p>If you have any questions, need help, or want to give feedback, please send an email to:</p>
            <p><strong>umt.teacher.reviews@gmail.com</strong></p>
            <button onClick={() => setShowContactModal(false)} className="modal-close-btn">Close</button>
        </div>
    </div>
)}
<footer className="app-footer">
    <div className="footer-content">
        <p>© {new Date().getFullYear()} UMT Teacher Reviews. All rights reserved.</p>
        <p>Developed by Munawar Hussain</p>
        <p className="footer-disclaimer">All reviews are student opinions and not official university statements.</p>
    </div>
</footer>

     </div>
     
        
    );
};

export default App;