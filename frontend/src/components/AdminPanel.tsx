import React, { useState, memo } from 'react';
import Icon from './Icon';
import type { Teacher, AdminReview, AdminQuestion } from '../types';

export interface AdminPanelProps {
    teachers: Teacher[];
    reviewsForModeration: AdminReview[];
    totalReviewsCount: number;
    onAddTeacher: (e: React.FormEvent) => void;
    onDeleteTeacher: (id: number) => void;
    onUpdateTeacher: (id: number, data: { name: string; department: string; image_url?: string }) => void;
    onDeleteReview: (id: number) => void;
    onLogout: () => void;
    showAddTeacherForm: boolean;
    setShowAddTeacherForm: (v: boolean) => void;
    newTeacherName: string;
    setNewTeacherName: (v: string) => void;
    newTeacherDepartment: string;
    setNewTeacherDepartment: (v: string) => void;
    newTeacherImage: string;
    setNewTeacherImage: (v: string) => void;
    totalTeachersCount: number;
    loadingMore: boolean;
    onLoadMore: () => void;
    searchTerm: string;
    onSearchChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    searchResults: Teacher[];
    isSearching: boolean;
    onLoadMoreReviews: () => void;
    adminLoadingMoreReviews: boolean;
    adminReviewsTotalPages: number;
    adminReviewsPage: number;
    adminQuestions: AdminQuestion[];
    onDeleteQuestion: (id: number) => void;
    adminMutationLoading: boolean;
    adminLoadingMoreQuestions: boolean;
    adminQuestionsPage: number;
    adminQuestionsTotalPages: number;
    onLoadMoreQuestions: () => void;
}

const AdminPanel = memo(({
    teachers,
    reviewsForModeration,
    totalReviewsCount,
    onAddTeacher,
    onDeleteTeacher,
    onUpdateTeacher,
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
    searchTerm,
    onSearchChange,
    searchResults,
    isSearching,
    onLoadMoreReviews,
    adminLoadingMoreReviews,
    adminReviewsTotalPages,
    adminReviewsPage,
    adminQuestions,
    onDeleteQuestion,
    adminMutationLoading,
    adminLoadingMoreQuestions,
    adminQuestionsPage,
    adminQuestionsTotalPages,
    onLoadMoreQuestions
}: AdminPanelProps) => {
    const totalReviews = totalReviewsCount || reviewsForModeration?.length || 0;

    const displayTeachers = searchTerm ? searchResults : teachers;

    // Edit state
    const [editingTeacherId, setEditingTeacherId] = useState<number | null>(null);
    const [editName, setEditName] = useState('');
    const [editDepartment, setEditDepartment] = useState('');
    const [editImageUrl, setEditImageUrl] = useState('');
    // Edit handlers
    const startEdit = (teacher: Teacher) => {
        setEditingTeacherId(teacher.id);
        setEditName(teacher.name);
        setEditDepartment(teacher.department);
        setEditImageUrl(teacher.image_url || '');
    };

    const cancelEdit = () => {
        setEditingTeacherId(null);
        setEditName('');
        setEditDepartment('');
        setEditImageUrl('');
    };

    const handleUpdate = async (id: number) => {
        await onUpdateTeacher(id, {
            name: editName,
            department: editDepartment,
            image_url: editImageUrl || undefined
        });
        cancelEdit();
    };

    return (
        <div className="admin-panel">
            <div className="admin-header">
                <h2 className="gradient-text">Admin Dashboard</h2>
                <div className="admin-stats">
                    <span><Icon name="book" size={15} /> {totalTeachersCount || teachers.length} Teachers</span>
                    <span><Icon name="message-circle" size={15} /> {totalReviews} Reviews</span>
                </div>
                <button onClick={onLogout} className="logout-btn">Logout</button>
            </div>

            <div className="admin-section">
                <button onClick={() => setShowAddTeacherForm(!showAddTeacherForm)} className="add-teacher-btn">
                    {showAddTeacherForm ? (
                        'Cancel'
                    ) : (
                        <>
                            <Icon name="plus" size={16} /> Add New Teacher
                        </>
                    )}
                </button>
                {showAddTeacherForm && (
                    <form onSubmit={onAddTeacher} className="add-teacher-form">
                        <input type="text" placeholder="Teacher Name" aria-label="New teacher name" value={newTeacherName} onChange={(e) => setNewTeacherName(e.target.value)} required />
                        <input type="text" placeholder="Department" aria-label="New teacher department" value={newTeacherDepartment} onChange={(e) => setNewTeacherDepartment(e.target.value)} required />
                        <input type="url" placeholder="Image URL (optional)" aria-label="New teacher image URL" value={newTeacherImage} onChange={(e) => setNewTeacherImage(e.target.value)} />
                        <button type="submit">Save Teacher</button>
                    </form>
                )}
            </div>

            <div className="admin-section">
                <h3>Manage Teachers</h3>
                <div className="search-box" style={{ marginBottom: '1rem' }}>
                    <input
                        type="text"
                        placeholder="Search teachers by name or department..."
                        aria-label="Search teachers by name or department"
                        value={searchTerm}
                        onChange={onSearchChange}
                        className="search-input"
                    />
                    {searchTerm && (
                        <div className="search-info">
                            Found {searchResults.length} teacher{searchResults.length !== 1 ? 's' : ''} matching "{searchTerm}"
                        </div>
                    )}
                </div>

                <div className="admin-list">
                    {isSearching ? (
                        <div className="loading">Searching...</div>
                    ) : displayTeachers.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>
                            {searchTerm ? 'No teachers found' : 'No teachers added yet'}
                        </p>
                    ) : (
                        displayTeachers.map((teacher: Teacher) => {
                            const isEditing = editingTeacherId === teacher.id;
                            return (
                                <div key={teacher.id} className="admin-item">
                                    {isEditing ? (
                                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <input
                                                type="text"
                                                value={editName}
                                                onChange={(e) => setEditName(e.target.value)}
                                                placeholder="Name"
                                                aria-label="Edit teacher name"
                                                className="search-input"
                                                style={{ margin: 0 }}
                                            />
                                            <input
                                                type="text"
                                                value={editDepartment}
                                                onChange={(e) => setEditDepartment(e.target.value)}
                                                placeholder="Department"
                                                aria-label="Edit teacher department"
                                                className="search-input"
                                                style={{ margin: 0 }}
                                            />
                                            <input
                                                type="url"
                                                value={editImageUrl}
                                                onChange={(e) => setEditImageUrl(e.target.value)}
                                                placeholder="Image URL (optional)"
                                                aria-label="Edit teacher image URL"
                                                className="search-input"
                                                style={{ margin: 0 }}
                                            />
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button onClick={() => handleUpdate(teacher.id)} className="btn-submit" style={{ padding: '4px 12px' }}>Save</button>
                                                <button onClick={cancelEdit} className="btn-cancel" style={{ padding: '4px 12px' }}>Cancel</button>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            <span><strong>{teacher.name}</strong> - {teacher.department}</span>
                                            <div>
                                                <button onClick={() => startEdit(teacher)} className="edit-btn" style={{ marginRight: '8px' }} aria-label={`Edit ${teacher.name}`}>
                                                    <Icon name="edit" size={14} />
                                                </button>
                                                <button onClick={() => onDeleteTeacher(teacher.id)} className="delete-btn" disabled={adminMutationLoading}>Delete</button>
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {!searchTerm && (
                    <>
                        {loadingMore && <div className="loading-more">Loading more teachers...</div>}
                        {!loadingMore && teachers.length < totalTeachersCount && (
                            <button onClick={onLoadMore} className="load-more-btn" style={{ marginTop: '1rem', width: '100%' }}>
                                Load More ({teachers.length} / {totalTeachersCount})
                            </button>
                        )}
                        {teachers.length === totalTeachersCount && totalTeachersCount > 0 && (
                            <div className="end-of-list">You've seen all {totalTeachersCount} teachers</div>
                        )}
                    </>
                )}
            </div>

            <div className="admin-section">
                <h3>Manage Reviews ({totalReviews})</h3>
                <div className="admin-list">
                    {totalReviews === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No reviews yet.</p>
                    ) : (
                        reviewsForModeration.map((review: AdminReview) => (
                            <div key={review.id} className="admin-item">
                                <div className="review-info">
                                    <strong>{review.teacher_name}</strong>
                                    <p style={{ marginTop: '8px', marginBottom: '5px' }}>"{review.comment}"</p>
                                    <small>
                                        <Icon name="user" size={12} /> {review.user_name || 'Anonymous'} | <Icon name="calendar" size={12} /> {new Date(review.created_at).toLocaleDateString()}
                                    </small>
                                </div>
                                <button onClick={() => onDeleteReview(review.id)} className="delete-btn" disabled={adminMutationLoading}>Delete</button>
                            </div>
                        ))
                    )}
                </div>
                {!adminLoadingMoreReviews && adminReviewsPage < adminReviewsTotalPages && (
                    <button onClick={onLoadMoreReviews} className="load-more-btn" style={{ marginTop: '1rem', width: '100%' }}>
                        Load More Reviews
                    </button>
                )}
                {adminLoadingMoreReviews && <div className="loading-more">Loading more reviews...</div>}
            </div>

            <div className="admin-section">
                <h3>Manage Questions ({adminQuestions.length})</h3>
                <div className="admin-list">
                    {adminQuestions.length === 0 ? (
                        <p style={{ textAlign: 'center', padding: '20px', color: '#999' }}>No questions yet.</p>
                    ) : (
                        adminQuestions.map((question: AdminQuestion) => (
                            <div key={question.id} className="admin-item">
                                <div className="review-info">
                                    <strong>{question.teacher_name}</strong>
                                    <p style={{ marginTop: '8px', marginBottom: '5px' }}>"{question.question}"</p>
                                    <small>
                                        <Icon name="message-circle" size={12} /> {question.answer_count} answer{question.answer_count !== 1 ? 's' : ''} | <Icon name="calendar" size={12} /> {new Date(question.created_at).toLocaleDateString()}
                                    </small>
                                </div>
                                <button
                                    onClick={() => onDeleteQuestion(question.id)}
                                    className="delete-btn"
                                    disabled={adminMutationLoading || adminLoadingMoreQuestions}
                                >
                                    Delete
                                </button>
                            </div>
                        ))
                    )}
                </div>
                {!adminLoadingMoreQuestions && adminQuestionsPage < adminQuestionsTotalPages && (
                    <button onClick={onLoadMoreQuestions} className="load-more-btn" style={{ marginTop: '1rem', width: '100%' }}>
                        Load More Questions
                    </button>
                )}
                {adminLoadingMoreQuestions && <div className="loading-more">Loading more questions...</div>}
            </div>
        </div>
    );
});

export default AdminPanel;
