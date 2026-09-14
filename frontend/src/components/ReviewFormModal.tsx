import React, { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import SearchableDropdown from './SearchableDropdown';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { getApprovedCustomCourses, suggestCustomCourse } from '../services/api';
import type { TeacherDetail } from '../types';

// All UMT course titles sorted alphabetically
const UMT_COURSES = [
    'Accounting',
    'Advanced Artificial Intelligence',
    'Advanced Computer Vision',
    'Advanced Database Management Systems',
    'Advanced Software System Architecture',
    'Advanced Web Technologies',
    'Agent Based Modeling',
    'Algebra and Trigonometry',
    'Analysis of Algorithms',
    'Application of Information & Communication Technologies',
    'Applied Physics',
    'Artificial Intelligence',
    'Artificial Neural Networks & Deep Learning',
    'Big Data Analytics',
    'Blockchain Technology and Application',
    'Calculus and Analytic Geometry',
    'Chemistry',
    'Civics and Community Engagement',
    'Compiler Construction',
    'Computer Networks',
    'Computer Organization & Assembly Language',
    'Computer Vision',
    'Cryptography',
    'Database Systems',
    'Data Communications',
    'Data Mining',
    'Data Science Technologies',
    'Data Structures',
    'Deep Learning & Neural Networks',
    'Differential Equations',
    'Digital Image Processing',
    'Digital Logic Design',
    'Discrete Structures',
    'Distributed Database System',
    'Embedded Systems',
    'English',
    'Entrepreneurship',
    'Environmental Science',
    'Expository Writing',
    'Final Year Project – I',
    'Final Year Project – II',
    'Food Science and Technology',
    'Functional English',
    'Fuzzy Systems',
    'Games Design and Development',
    'Hardware Security',
    'Human Computer Interaction',
    'Ideology and Constitution of Pakistan',
    'Information Security',
    'Innovation and Entrepreneurship',
    'Internet of Things',
    'Introduction to Robotics',
    'Introduction to Statistics',
    'Islamic Thought and Perspective',
    'Knowledge Representation & Reasoning',
    'Linear Algebra',
    'Machine Learning',
    'Malware Analysis',
    'Managerial Accounting',
    'Marketing Management',
    'Mobile Application Development',
    'Multivariable Calculus',
    'Natural Language Processing',
    'Network Security',
    'Numerical Analysis',
    'Object Oriented Programming',
    'Operating Systems',
    'Open-Source Software Development',
    'Operations Research',
    'Parallel & Distributed Computing',
    'Penetration Testing',
    'Philosophy',
    'Physics',
    'Probability & Statistics',
    'Professional Practices',
    'Programming for AI',
    'Programming Fundamentals',
    'Reinforcement Learning',
    'Research Methods',
    'Site Reliability Engineering',
    'Software Construction and Development',
    'Software Engineering',
    'Software Project Management',
    'Speech Processing',
    'Strategic Management',
    'Supply Chain Management',
    'Technical & Business Writing',
    'Textile Design',
    'Theory of Automata',
    'Topics in AI',
    'Web Technologies',
    'Wireless and Mobile Security',
].sort((a, b) => a.localeCompare(b));

interface ReviewFormModalProps {
    selectedTeacher: TeacherDetail;
    reviewComment: string;
    setReviewComment: (v: string) => void;
    reviewUserName: string;
    setReviewUserName: (v: string) => void;
    reviewCourses: string[];
    setReviewCourses: (v: string[]) => void;
    reviewError: string;
    submitting: boolean;
    onSubmit: (e: React.FormEvent) => void;
    onClose: () => void;
}

const ReviewFormModal: React.FC<ReviewFormModalProps> = ({
    selectedTeacher,
    reviewComment,
    setReviewComment,
    reviewUserName,
    setReviewUserName,
    reviewCourses,
    setReviewCourses,
    reviewError,
    submitting,
    onSubmit,
    onClose,
}) => {
    const trapRef = useFocusTrap(true);

    // Approved community-added courses, merged into the built-in list
    const [customCourses, setCustomCourses] = useState<string[]>([]);
    useEffect(() => {
        let cancelled = false;
        getApprovedCustomCourses()
            .then(res => {
                if (!cancelled) setCustomCourses(res.data?.courses || []);
            })
            .catch(() => {
                // Silent failure – built-in list still works
            });
        return () => { cancelled = true; };
    }, []);

    const allCourses = useMemo(
        () => Array.from(new Set([...UMT_COURSES, ...customCourses])).sort((a, b) => a.localeCompare(b)),
        [customCourses]
    );

    // Auto-suggest newly added custom courses for admin approval (fire & forget)
    const suggestedRef = useRef<Set<string>>(new Set());
    const buttonsRef = useRef<HTMLDivElement>(null);

    // Action buttons stay hidden until the user engages with the review box —
    // no clutter while picking courses or reading the form.
    const [showActions, setShowActions] = useState(false);

    // Mobile: tapping the courses field opens a dedicated full-screen picker page
    const [coursePageOpen, setCoursePageOpen] = useState(false);

    // Track mobile viewport (course field routes to the full-screen page there)
    const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 768px)').matches);
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 768px)');
        const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    const openCoursePage = () => {
        setShowActions(false);
        setCoursePageOpen(true);
    };

    // When the user taps the review box, reveal the buttons and bring them into view
    const scrollButtonsIntoView = () => {
        setShowActions(true);
        if (window.innerWidth > 768) return;
        // Wait for the keyboard/sheet resize to settle, then reveal the buttons
        setTimeout(() => {
            buttonsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }, 250);
    };
    const handleCoursesChange = (next: string[]) => {
        const known = new Set(allCourses.map(c => c.toLowerCase()));
        next.forEach(course => {
            const key = course.trim().toLowerCase();
            if (key && !known.has(key) && !suggestedRef.current.has(key)) {
                suggestedRef.current.add(key);
                suggestCustomCourse(course.trim()).catch(() => {
                    suggestedRef.current.delete(key); // allow retry on next attempt
                });
            }
        });
        setReviewCourses(next);
    };

    // Close on Escape key — close the course picker first, then the sheet
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (coursePageOpen) {
                    setCoursePageOpen(false);
                    return;
                }
                onClose();
            }
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose, coursePageOpen]);

    return (
        <div className="modal-overlay" onClick={onClose} role="presentation">
            <div
                ref={trapRef}
                className="modal-content review-sheet"
                tabIndex={-1}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-label={`Write a review for ${selectedTeacher.name}`}
            >
                {!coursePageOpen && (
                    <h3 className="review-form-title" id="review-modal-title">
                        <Icon name="edit" size={20} /> Write a Review for {selectedTeacher.name}
                    </h3>
                )}
                {reviewError && (
                    <div className="error-message" role="alert" aria-live="assertive">
                        {reviewError}
                    </div>
                )}
                {coursePageOpen ? (
                    <div className="course-picker-page" role="dialog" aria-label="Select courses">
                        <div className="course-picker-header">
                            <button
                                type="button"
                                className="course-picker-back"
                                onClick={() => setCoursePageOpen(false)}
                                aria-label="Back to review form"
                            >
                                ‹ Back
                            </button>
                            <span className="course-picker-title">Select Courses</span>
                            {reviewCourses.length > 0 && (
                                <span className="course-picker-count">{reviewCourses.length}</span>
                            )}
                        </div>
                        <SearchableDropdown
                            label="Courses"
                            id="review-courses-page"
                            value={reviewCourses}
                            onChange={handleCoursesChange}
                            options={allCourses}
                            variant="page"
                            onDone={() => setCoursePageOpen(false)}
                        />
                    </div>
                ) : (
                <form className="review-form" onSubmit={onSubmit} aria-labelledby="review-modal-title">
                    <div className="review-form-body">
                    <section className="form-section" aria-label="Step 1: your name">
                        <div className="form-section-head">
                            <span className="form-section-num">1</span>
                            <h4 className="form-section-title">Your Name</h4>
                            <span className="form-section-hint">optional</span>
                        </div>
                        <input
                            id="review-user-name"
                            type="text"
                            value={reviewUserName}
                            onChange={(e) => setReviewUserName(e.target.value)}
                            placeholder="Leave blank to post anonymously"
                            autoComplete="name"
                        />
                    </section>

                    <section className="form-section" aria-label="Step 2: courses">
                        <div className="form-section-head">
                            <span className="form-section-num">2</span>
                            <h4 className="form-section-title">Courses</h4>
                        </div>
                        {isMobile ? (
                            <button
                                type="button"
                                className="course-field-link"
                                onClick={openCoursePage}
                                aria-haspopup="dialog"
                            >
                                <span className={`course-field-link-text ${reviewCourses.length === 0 ? 'placeholder' : ''}`}>
                                    {reviewCourses.length === 0
                                        ? 'Tap to choose courses...'
                                        : reviewCourses.join(', ')}
                                </span>
                                <span className="course-field-link-arrow" aria-hidden="true">›</span>
                            </button>
                        ) : (
                            <SearchableDropdown
                                label="Select courses"
                                id="review-courses"
                                value={reviewCourses}
                                onChange={handleCoursesChange}
                                options={allCourses}
                                placeholder="Search or scroll to select courses..."
                                required={false}
                            />
                        )}
                    </section>

                    <section className="form-section" aria-label="Step 3: your review">
                        <div className="form-section-head">
                            <span className="form-section-num">3</span>
                            <h4 className="form-section-title">Your Review</h4>
                            <span className="form-section-hint">required</span>
                        </div>
                        <textarea
                            id="review-comment"
                            rows={5}
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            onFocus={scrollButtonsIntoView}
                            placeholder="Share your experience with this teacher..."
                            required
                            aria-required="true"
                        />
                    </section>

                    <div className={`form-buttons${showActions ? ' form-buttons-visible' : ''}`} ref={buttonsRef}>
                        <button type="button" onClick={onClose} className="btn-cancel">
                            Cancel
                        </button>
                        <button type="submit" disabled={submitting} className="btn-submit" aria-busy={submitting}>
                            {submitting ? (
                                <>
                                    <span className="spinner-small" aria-hidden="true"></span>
                                    <span>Submitting...</span>
                                </>
                            ) : (
                                'Submit Review'
                            )}
                        </button>
                    </div>
                    </div>
                </form>
                )}
            </div>
        </div>
    );
};

export default ReviewFormModal;
