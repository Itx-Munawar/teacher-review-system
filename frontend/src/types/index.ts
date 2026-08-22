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