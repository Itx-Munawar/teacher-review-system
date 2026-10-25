import type { Teacher, TeacherDetail, Review } from '../types';

/** Shape of GET /api/teachers/:id (older responses were the bare teacher). */
export interface TeacherDetailResponse {
    teacher?: Teacher;
    reviews?: Review[];
    total_reviews?: number;
    review_pagination?: TeacherDetail['review_pagination'];
}

/** Map a teacher-detail API response to the TeacherDetail the UI renders. */
export const mapTeacherDetail = (data: TeacherDetailResponse, fallback?: TeacherDetail): TeacherDetail => {
    const teacherInfo: Teacher = data.teacher || fallback || (data as unknown as Teacher);
    const reviewsList = data.reviews || [];
    const totalReviews = data.total_reviews || 0;
    return {
        id: teacherInfo.id,
        name: teacherInfo.name,
        department: teacherInfo.department,
        review_count: totalReviews,
        total_reviews: totalReviews,
        image_url: teacherInfo.image_url || undefined,
        reviews: reviewsList,
        review_pagination: data.review_pagination,
    };
};
