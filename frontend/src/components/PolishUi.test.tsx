import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import TeacherDetailView from './TeacherDetailView';
import TeacherSidebar from './TeacherSidebar';
import QuestionsView from './QuestionsView';
import CompareView from './CompareView';
import EmptyState from './EmptyState';
import type { Teacher, TeacherDetail } from '../types';
import type { BoardQuestion } from '../services/api';

vi.mock('./LazySection', () => ({
    default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('./QASection', () => ({ default: () => null }));

// One api mock for the whole file: the detail view needs the summary/reply/vote
// functions, the Q&A board needs getAllQuestions/submitAnswer.
const mockedApi = vi.hoisted(() => ({
    getAllQuestions: vi.fn(),
    submitAnswer: vi.fn(),
    replyToReview: vi.fn(),
    voteHelpful: vi.fn(),
    getTeacherSummary: vi.fn(),
}));
vi.mock('../services/api', () => mockedApi);

const makeDetailTeacher = (overrides: Partial<TeacherDetail> = {}): TeacherDetail => ({
    id: 7,
    name: 'Waqar Ashiq',
    department: 'School of Systems and Technology',
    review_count: 2,
    total_reviews: 2,
    review_sort: 'helpful',
    review_course: null,
    course_counts: [],
    reviews: [
        { id: 1, teacher_id: 7, comment: 'Explains every concept clearly.', user_name: 'A', created_at: '2026-01-01T10:00:00Z', helpful_count: 0, voted: false },
        { id: 2, teacher_id: 7, comment: 'Strict about attendance.', user_name: 'B', created_at: '2026-03-01T10:00:00Z', helpful_count: 0, voted: false },
    ],
    ...overrides,
});

const renderDetail = (teacher: TeacherDetail, related: Teacher[] = []) => {
    render(
        <TeacherDetailView
            selectedTeacher={teacher}
            relatedTeachers={related}
            onShowReviewForm={vi.fn()}
            onClearSelectedTeacher={vi.fn()}
            onTeacherClick={vi.fn()}
            showToast={vi.fn()}
            onChangeReviewQuery={vi.fn()}
        />
    );
};

describe('Polish — teacher detail', () => {
    it('shows 0 Courses instead of a dash when no course info exists', () => {
        renderDetail(makeDetailTeacher());
        const values = Array.from(document.querySelectorAll('.profile-stat-value')).map((el) => el.textContent);
        expect(values).toContain('0');
        expect(screen.getByText('Courses')).toBeTruthy();
    });

    it('related cards show the department and the review count', () => {
        const related: Teacher[] = [
            { id: 8, name: 'Bilal Hussain', department: 'School of Engineering', review_count: 3 },
            { id: 9, name: 'Jaweria Aslam', department: 'School of Science', review_count: 0 },
        ];
        renderDetail(makeDetailTeacher(), related);
        expect(screen.getByText('School of Engineering')).toBeTruthy();
        expect(screen.getByText(/3 reviews/)).toBeTruthy();
        expect(screen.getByText(/No reviews yet/)).toBeTruthy();
    });

    it('uses the compact sort-only toolbar when there are no course chips', () => {
        renderDetail(makeDetailTeacher());
        expect(document.querySelector('.review-toolbar-sort-only')).toBeTruthy();
    });

    it('keeps the full toolbar chrome when course chips exist', () => {
        renderDetail(makeDetailTeacher({
            course_counts: [
                { course: 'Calculus I', count: 2 },
                { course: 'Linear Algebra', count: 1 },
            ],
        }));
        expect(document.querySelector('.review-toolbar-sort-only')).toBeNull();
        expect(document.querySelector('.review-toolbar')).toBeTruthy();
    });

    it('styles Reply as a pill next to the Helpful pill', () => {
        renderDetail(makeDetailTeacher());
        expect(document.querySelector('.review-reply-trigger')).toBeTruthy();
        expect(document.querySelector('.review-helpful')).toBeTruthy();
    });
});

describe('Polish — sidebar zero counts', () => {
    const baseProps = {
        hiddenOnMobile: false,
        searchTerm: '',
        handleSearch: vi.fn(),
        searchInputRef: { current: null } as React.RefObject<HTMLInputElement | null>,
        handleAutocompleteSelect: vi.fn(),
        handleCompareToggle: vi.fn(),
        compareList: [] as Teacher[],
        isSearching: false,
        searchResults: [] as Teacher[],
        sortBy: 'reviews',
        setSortBy: vi.fn(),
        departmentFilter: '',
        setDepartmentFilter: vi.fn(),
        departments: [],
        loading: false,
        error: null,
        loadTeachers: vi.fn(),
        handleTeacherClick: vi.fn(),
        loadingMore: false,
        hasMore: false,
        loadMore: vi.fn(),
        teachers: [] as Teacher[],
        totalTeachersCount: 2,
    };

    it('mutes the count for teachers with no reviews', () => {
        const displayTeachers: Teacher[] = [
            { id: 54, name: 'Ali Raza', department: 'School of Science', review_count: 0 },
            { id: 53, name: 'Ali Harris', department: 'School of Science', review_count: 2 },
        ];
        render(<TeacherSidebar {...baseProps} displayTeachers={displayTeachers} teachers={displayTeachers} />);
        const zero = screen.getByText('0 reviews');
        expect(zero.classList.contains('reviews-count-zero')).toBe(true);
        expect(screen.getByText('2 reviews').classList.contains('reviews-count-zero')).toBe(false);
    });
});

describe('Polish — Q&A board', () => {
    beforeEach(() => {
        mockedApi.getAllQuestions.mockReset();
        mockedApi.submitAnswer.mockReset();
    });

    const answered: BoardQuestion = {
        id: 1,
        question: 'Is attendance strict?',
        created_at: '2026-10-01T10:00:00Z',
        teacher_id: 53,
        teacher_name: 'Ali Harris',
        teacher_department: 'School of Systems and Technology',
        answers: [{ id: 11, answer: 'Yes, very.', created_at: '2026-10-02T10:00:00Z' }],
    };
    const unanswered: BoardQuestion = {
        id: 2,
        question: 'Which book do we follow?',
        created_at: '2026-10-03T10:00:00Z',
        teacher_id: 53,
        teacher_name: 'Ali Harris',
        teacher_department: 'School of Systems and Technology',
        answers: [],
    };

    beforeEach(() => {
        mockedApi.getAllQuestions.mockReset();
        mockedApi.submitAnswer.mockReset();
    });

    it('shows a skeleton while questions load', () => {
        mockedApi.getAllQuestions.mockReturnValue(new Promise(() => {}));
        render(<QuestionsView onOpenTeacher={vi.fn()} onBack={vi.fn()} />);
        expect(screen.getByRole('status', { name: 'Loading questions' })).toBeTruthy();
        expect(document.querySelectorAll('.qa-skeleton-bar').length).toBeGreaterThan(0);
        expect(screen.queryByText('Loading questions...')).toBeNull();
    });

    it('labels answered and unanswered questions', async () => {
        mockedApi.getAllQuestions.mockResolvedValue({
            data: { questions: [answered, unanswered], pagination: { page: 1, totalPages: 1, total: 2 } },
        });
        render(<QuestionsView onOpenTeacher={vi.fn()} onBack={vi.fn()} />);
        await waitFor(() => expect(screen.getByText('Is attendance strict?')).toBeTruthy());
        expect(screen.getByText('✓ 1 answer')).toBeTruthy();
        expect(screen.getByText('Awaiting answer')).toBeTruthy();
    });
});

describe('Polish — compare', () => {
    const makeDetail = (id: number, name: string, comment: string): TeacherDetail => ({
        id,
        name,
        department: 'School of Systems and Technology',
        review_count: 1,
        total_reviews: 1,
        reviews: [{ id: id * 10, teacher_id: id, comment, user_name: 'Anonymous', created_at: '2026-10-01T10:00:00Z' }],
    });

    const renderCompare = (list: Teacher[], details: TeacherDetail[]) => {
        render(
            <CompareView
                compareDetails={details}
                compareList={list}
                compareSearchTerm=""
                setCompareSearchTerm={vi.fn()}
                compareSearchInputRef={{ current: null }}
                handleCompareAdd={vi.fn()}
                setIsComparing={vi.fn()}
                restoreListScroll={vi.fn()}
                handleTeacherClick={vi.fn()}
                setCompareList={vi.fn()}
                setCompareDetails={vi.fn()}
            />
        );
    };

    it('tells the user the comparison is full at 3/3', () => {
        const list: Teacher[] = [
            { id: 1, name: 'A', department: 'D', review_count: 1 },
            { id: 2, name: 'B', department: 'D', review_count: 1 },
            { id: 3, name: 'C', department: 'D', review_count: 1 },
        ];
        renderCompare(list, list.map((t) => makeDetail(t.id, t.name, 'Short comment.')));
        expect(screen.getByText(/3\/3 selected — remove one below/)).toBeTruthy();
    });

    it('shows the full recent review instead of cutting it mid-word', () => {
        const commentA = 'Cooperative and supportive in class, always ready to explain the same topic again until everyone understands it fully.';
        const commentB = 'Patient with questions and generous with office hours, the kind of teacher who remembers every student by name.';
        const list: Teacher[] = [
            { id: 1, name: 'A', department: 'D', review_count: 1 },
            { id: 2, name: 'B', department: 'D', review_count: 1 },
        ];
        renderCompare(list, [makeDetail(1, 'A', commentA), makeDetail(2, 'B', commentB)]);
        // The table's quote boxes must carry the full text, never a mid-word cut.
        const snippets = Array.from(document.querySelectorAll('.compare-snippet-text')).map((el) => el.textContent);
        expect(snippets).toContain(`"${commentA}"`);
        expect(snippets).toContain(`"${commentB}"`);
        expect(snippets.join(' ')).not.toContain('coope…');
    });
});

describe('Polish — empty states', () => {
    it('renders the compact variant when asked', () => {
        const { container } = render(<EmptyState icon="help" title="No questions yet" message="Ask the first one." compact />);
        expect(container.querySelector('.empty-state-compact')).toBeTruthy();
    });

    it('renders the regular variant by default', () => {
        const { container } = render(<EmptyState icon="help" title="No questions yet" message="Ask the first one." />);
        expect(container.querySelector('.empty-state-compact')).toBeNull();
    });
});
