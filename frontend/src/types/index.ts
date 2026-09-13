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
}

export interface TeacherDetail extends Teacher {
    reviews: Review[];
    total_reviews: number;
}

export interface AdminReview {
    id: number;
    teacher_id: number;
    teacher_name: string;
    comment: string;
    user_name: string;
    courses?: string;
    created_at: string;
}

export interface AdminQuestion {
    id: number;
    teacher_id: number;
    teacher_name: string;
    question: string;
    answer_count: number;
    created_at: string;
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