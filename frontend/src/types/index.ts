export interface Teacher {
    id: number;
    name: string;
    department: string;
    review_count: number;
    created_at?: string;
    image_url?: string;
}

export interface Review {
    id: number;
    teacher_id: number;
    comment: string;
    user_name: string;
    courses?: string;
    created_at: string;
    /** Triage marker written by the content filter; only admins see it. */
    moderation_flag?: 'sensitive' | 'bias' | 'profanity' | null;
    /** Approved replies (public teacher-detail payloads). */
    replies?: ReviewReply[];
    /** "Helpful" votes and whether this browser cast one. */
    helpful_count?: number;
    voted?: boolean;
}

export type ReviewSort = 'newest' | 'helpful';

/** How the reviews list on a teacher page is ordered and filtered. */
export interface ReviewQuery {
    sort: ReviewSort;
    course: string | null;
}

export interface CourseCount {
    course: string;
    count: number;
}

/** GET /api/teachers/:id/summary */
export type TeacherSummary =
    | { available: true; overview: string; pros: string[]; cons: string[]; review_count: number; generated_at: string; stale?: boolean }
    | { available: false; reason: 'disabled' | 'few_reviews' | 'busy' | 'not_found'; min_reviews?: number };

/** A moderator-approved reply shown under a review. */
export interface ReviewReply {
    id: number;
    review_id: number;
    reply: string;
    user_name: string;
    created_at: string;
}

export interface TeacherDetail extends Teacher {
    reviews: Review[];
    total_reviews: number;
    /** Reviews matching the current course filter (= total_reviews when unfiltered). */
    filtered_reviews?: number;
    review_sort?: ReviewSort;
    review_course?: string | null;
    /** Courses mentioned across all approved reviews, most common first. */
    course_counts?: CourseCount[];
    /** Present on paginated teacher-detail responses. */
    review_pagination?: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}

export interface AdminReview {
    id: number;
    teacher_id: number;
    teacher_name: string;
    comment: string;
    user_name: string;
    courses?: string;
    /** MySQL returns 0/1; some payloads may carry booleans - treat either as pending/approved. */
    is_approved: boolean | number;
    created_at: string;
    /** Triage marker written by the content filter. */
    moderation_flag?: 'sensitive' | 'bias' | 'profanity' | null;
}

export interface AdminQuestion {
    id: number;
    teacher_id: number;
    teacher_name: string;
    question: string;
    answer_count: number;
    is_approved: number;
    created_at: string;
    answers?: { id: number; question_id: number; answer: string; is_approved: number; created_at: string }[];
}

export interface AdminTeacherReview extends Review {
    teacher_name: string;
    is_approved: number;
}

export interface AdminTeacherDetail {
    teacher: Teacher;
    reviews: AdminTeacherReview[];
    stats: {
        total_reviews: number;
        approved_reviews: number;
        pending_reviews: number;
        questions: number;
    };
}

export interface CustomCourse {
    id: number;
    name: string;
    status: 'pending' | 'approved' | 'rejected';
    times_used: number;
    created_at: string;
    reviewed_at: string | null;
}

/** A reply as the admin Replies tab sees it, with its parent review. */
export interface AdminReply {
    id: number;
    review_id: number;
    reply: string;
    user_name: string;
    /** MySQL returns 0/1. */
    is_approved: boolean | number;
    moderation_flag?: 'sensitive' | 'bias' | 'profanity' | null;
    created_at: string;
    /** Null if the parent review no longer exists. */
    review_comment: string | null;
    review_user_name: string | null;
    review_is_approved: boolean | number | null;
    teacher_id: number | null;
    teacher_name: string | null;
}

export interface AdminStats {
    total_teachers: number;
    total_reviews: number;
    reviews_last_week: number;
    pending_reviews?: number;
    pending_replies?: number;
    /** Unresolved entries in the Errors tab. */
    open_errors?: number;
    last_sweep?: { scanned: number; queued: number; already_queued?: number; at: string } | null;
}

/** A row from the admin audit trail. ip_address is a keyed hash, not an IP. */
export interface AdminAuditLog {
    id: number;
    action: string;
    details: string | null;
    ip_address: string | null;
    created_at: string;
    admin_username: string | null;
}

/** A teacher search that matched no one in the directory. */
export interface SearchGap {
    query: string;
    times: number;
    last_seen: string;
}

export interface Toast {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info';
}

export interface PaginatedResponse<T> {
    data?: T[];
    teachers?: T[];
    reviews?: T[];
    pagination: {
        page: number;
        limit: number;
        total: number;
        totalPages: number;
    };
}
/** A grouped error from GET /api/admin/errors. */
export interface AdminErrorLog {
    id: number;
    source: 'backend' | 'frontend' | string;
    message: string;
    stack: string | null;
    path: string | null;
    method: string | null;
    user_agent: string | null;
    occurrences: number;
    first_seen: string;
    last_seen: string;
    alerted_at: string | null;
    resolved: number | boolean;
}

/** GET /api/admin/analytics */
export interface AdminAnalytics {
    available: boolean;
    days: number;
    totals?: {
        visits: number;
        teacher_views: number;
        reviews_submitted: number;
        replies_submitted: number;
        helpful_votes: number;
        questions_asked: number;
    };
    daily?: { day: string; visits: number; teacher_views: number; reviews: number }[];
    top_teachers?: { id: number; name: string; department: string; views: number; reviews: number }[];
    needs_reviews?: { id: number; name: string; department: string; views: number; reviews: number }[];
    top_searches?: { term: string; searches: number; min_results: number }[];
    departments?: { department: string; teachers: number; reviewed_teachers: number; reviews: number; views: number }[];
}
