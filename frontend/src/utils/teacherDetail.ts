import type { Teacher, TeacherDetail, Review } from '../types';

/** Shape of GET /api/teachers/:id (older responses were the bare teacher). */
export interface TeacherDetailResponse {
    teacher?: Teacher;
    reviews?: Review[];
    total_reviews?: number;
    review_pagination?: TeacherDetail['review_pagination'];
    filtered_reviews?: number;
    review_sort?: TeacherDetail['review_sort'];
    review_course?: string | null;
    course_counts?: TeacherDetail['course_counts'];
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
        filtered_reviews: data.filtered_reviews ?? totalReviews,
        review_sort: data.review_sort || 'helpful',
        review_course: data.review_course || null,
        course_counts: data.course_counts || fallback?.course_counts,
    };
};
