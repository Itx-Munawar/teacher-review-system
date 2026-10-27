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
}

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