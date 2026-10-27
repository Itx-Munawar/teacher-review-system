import React, { lazy, Suspense } from 'react';
import ErrorBoundary from './ErrorBoundary';
import ChunkFallback from './ChunkFallback';
import { ToastHost } from './Toast';
import type { AdminState } from '../hooks/useAdmin';
import type { Teacher, Toast } from '../types';

// The admin screens are rarely opened, so they ship in their own chunks
// instead of the bundle every visitor downloads.
const AdminPanel = lazy(() => import('./AdminPanel'));
const LoginForm = lazy(() => import('./LoginForm'));

interface AdminScreenProps {
    admin: AdminState;
    toasts: Toast[];
    dismissToast: (id: number) => void;
    headerScrolled: boolean;
    teachers: Teacher[];
    departments: { department: string; teacher_count: number }[];
    totalTeachersCount: number;
    loadingMore: boolean;
    handleLoadMoreTeachers: () => void;
}

/** /admin: session check, login form (with 2FA step) or the admin panel. */
const AdminScreen: React.FC<AdminScreenProps> = ({
    admin,
    toasts,
    dismissToast,
    headerScrolled,
    teachers,
    departments,
    totalTeachersCount,
    loadingMore,
    handleLoadMoreTeachers,
}) => {
    const {
        isAdminLoggedIn,
        adminAuthChecked,
        adminMutationLoading,
        adminUsername,
        setAdminUsername,
        adminPassword,
        setAdminPassword,
        adminError,
        admin_totp_code,
        setAdmin_totp_code,
        requires_totp,
        showAddTeacherForm,
        setShowAddTeacherForm,
        newTeacherName,
        setNewTeacherName,
        newTeacherDepartment,
        setNewTeacherDepartment,
        newTeacherImage,
        setNewTeacherImage,
        reviewsForModeration,
        adminStats,
        adminTotpEnabled,
        adminSearchTerm,
        adminSearchResults,
        adminIsSearching,
        closeAdminPanel,
        handleAdminSearch,
        adminReviewsPage,
        adminReviewsTotalPages,
        adminLoadingMoreReviews,
        adminQuestions,
        adminQuestionsPage,
        adminQuestionsTotalPages,
        adminLoadingMoreQuestions,
        customCourses,
        reviewsPendingOnly,
        adminReplies,
        adminRepliesPage,
        adminRepliesTotalPages,
        adminLoadingMoreReplies,
        adminRepliesStatus,
        handleTogglePendingOnly,
        handleLoadMoreReviews,
        handleLoadMoreQuestions,
        handleLoadMoreReplies,
        handleRepliesStatusChange,
        handleSetReplyApproved,
        handleUpdateReply,
        handleDeleteReply,
        handleBulkReplies,
        refreshAdminStats,
        showToast,
        handleReviewCustomCourse,
        handleLoadTeacherDetail,
        handleAdminLogin,
        handleAdminLogout,
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
    } = admin;

    if (!isAdminLoggedIn) {
        // On a refresh at /admin the cookie check needs a moment; don't
        // flash the login form (or the public site) in the meantime.
        if (!adminAuthChecked) {
            return (
                <div className="app">
                    <ToastHost toasts={toasts} onDismiss={dismissToast} />
                    <header className={`header${headerScrolled ? ' header-scrolled' : ''}`}>
                        <h1>Teacher Review System - Admin</h1>
                        <button onClick={closeAdminPanel} className="back-to-site-btn">← Back to Site</button>
                    </header>
                    <div className="container">
                        <div className="loading" role="status">Checking admin session…</div>
                    </div>
                </div>
            );
        }
        return (
            <div className="app">
                <ToastHost toasts={toasts} onDismiss={dismissToast} />
            <header className={`header${headerScrolled ? ' header-scrolled' : ''}`}>
                    <h1>Teacher Review System - Admin</h1>
                    <button onClick={closeAdminPanel} className="back-to-site-btn">← Back to Site</button>
                </header>
                <div className="container">
                    <ErrorBoundary>
                    <Suspense fallback={<ChunkFallback />}>
                    <LoginForm
                        adminUsername={adminUsername}
                        setAdminUsername={setAdminUsername}
                        adminPassword={adminPassword}
                        setAdminPassword={setAdminPassword}
                        adminError={adminError}
                        onLogin={handleAdminLogin}
                        requires_totp={requires_totp}
                        admin_totp_code={admin_totp_code}
                        setAdmin_totp_code={setAdmin_totp_code}
                    />
                    </Suspense>
                    </ErrorBoundary>
                </div>
            </div>
        );
    }
    return (
        <div className="app">
            <ToastHost toasts={toasts} onDismiss={dismissToast} />
            <header className="header">
                <h1>Teacher Review System - Admin Panel</h1>
                <button onClick={closeAdminPanel} className="back-to-site-btn">← Back to Site</button>
            </header>
            <div className="container">
                <ErrorBoundary>
                <Suspense fallback={<ChunkFallback />}>
                <AdminPanel
                    teachers={teachers}
                    reviewsForModeration={reviewsForModeration}
                    totalReviewsCount={adminStats?.total_reviews ?? 0}
                    pendingReviewsCount={adminStats?.pending_reviews ?? 0}
                    reviewsPendingOnly={reviewsPendingOnly}
                    onTogglePendingOnly={handleTogglePendingOnly}
                    onAddTeacher={handleAddTeacher}
                    onUpdateTeacher={handleUpdateTeacher}
                    onDeleteTeacher={handleDeleteTeacher}
                    onDeleteReview={handleDeleteReview}
                    onUpdateReview={handleUpdateReview}
                    onLogout={handleAdminLogout}
                    showAddTeacherForm={showAddTeacherForm}
                    setShowAddTeacherForm={setShowAddTeacherForm}
                    newTeacherName={newTeacherName}
                    setNewTeacherName={setNewTeacherName}
                    newTeacherDepartment={newTeacherDepartment}
                    setNewTeacherDepartment={setNewTeacherDepartment}
                    departmentOptions={departments.map((d) => d.department)}
                    newTeacherImage={newTeacherImage}
                    setNewTeacherImage={setNewTeacherImage}
                    totalTeachersCount={totalTeachersCount}
                    loadingMore={loadingMore}
                    onLoadMore={handleLoadMoreTeachers}
                    searchTerm={adminSearchTerm}
                    onSearchChange={handleAdminSearch}
                    searchResults={adminSearchResults}
                    isSearching={adminIsSearching}
                    onLoadMoreReviews={handleLoadMoreReviews}
                    adminLoadingMoreReviews={adminLoadingMoreReviews}
                    adminReviewsTotalPages={adminReviewsTotalPages}
                    adminReviewsPage={adminReviewsPage}
                    adminQuestions={adminQuestions}
                    onDeleteQuestion={handleDeleteQuestion}
                    onUpdateQuestion={handleUpdateQuestion}
                    onUpdateAnswer={handleUpdateAnswer}
                    onDeleteAnswer={handleDeleteAnswer}
                    onBulkReviewDecision={handleBulkReviewDecision}
                    adminMutationLoading={adminMutationLoading}
                    adminLoadingMoreQuestions={adminLoadingMoreQuestions}
                    adminQuestionsPage={adminQuestionsPage}
                    adminQuestionsTotalPages={adminQuestionsTotalPages}
                    onLoadMoreQuestions={handleLoadMoreQuestions}
                    customCourses={customCourses}
                    onReviewCourse={handleReviewCustomCourse}
                    onLoadTeacherDetail={handleLoadTeacherDetail}
                    onCleanTeacherImages={handleCleanTeacherImages}
                    onApproveReview={handleApproveReview}
                    onRejectReview={handleRejectReview}
                    replies={adminReplies}
                    pendingRepliesCount={adminStats?.pending_replies ?? 0}
                    repliesStatus={adminRepliesStatus}
                    onRepliesStatusChange={handleRepliesStatusChange}
                    onSetReplyApproved={handleSetReplyApproved}
                    onUpdateReply={handleUpdateReply}
                    onDeleteReply={handleDeleteReply}
                    onBulkReplies={handleBulkReplies}
                    openErrorsCount={adminStats?.open_errors ?? 0}
                    onRefreshStats={refreshAdminStats}
                    showToast={showToast}
                    onLoadMoreReplies={handleLoadMoreReplies}
                    adminRepliesPage={adminRepliesPage}
                    adminRepliesTotalPages={adminRepliesTotalPages}
                    adminLoadingMoreReplies={adminLoadingMoreReplies}
                    totpEnabled={adminTotpEnabled}
                />
                </Suspense>
                </ErrorBoundary>
            </div>
        </div>
    );
};

export default AdminScreen;
