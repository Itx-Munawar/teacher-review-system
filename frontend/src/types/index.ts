export interface Teacher {
    id: number;
    name: string;
    department: string;
    avg_rating: number;
    review_count: number;
    created_at?: string;
    image_url?: string;   // teacher profile image
}

export interface Review {
    id: number;
    teacher_id: number;
    rating: number;
    comment: string;
    user_name: string;
    created_at: string;
}

export interface TeacherDetail extends Teacher {
    reviews: Review[];
    total_reviews: number;
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