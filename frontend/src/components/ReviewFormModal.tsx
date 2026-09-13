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

    // Close on Escape key
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [onClose]);

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
                <h3 className="review-form-title" id="review-modal-title">
                    <Icon name="edit" size={20} /> Write a Review for {selectedTeacher.name}
                </h3>
                {reviewError && (
                    <div className="error-message" role="alert" aria-live="assertive">
                        {reviewError}
                    </div>
                )}
                <form className="review-form" onSubmit={onSubmit} aria-labelledby="review-modal-title">
                    <div className="review-form-body">
                    <div className="form-group">
                        <label htmlFor="review-user-name">Your Name (optional)</label>
                        <input
                            id="review-user-name"
                            type="text"
                            value={reviewUserName}
                            onChange={(e) => setReviewUserName(e.target.value)}
                            placeholder="Leave blank to post anonymously"
                            autoComplete="name"
                        />
                    </div>
                    <SearchableDropdown
                        label="Courses (select one or more)"
                        id="review-courses"
                        value={reviewCourses}
                        onChange={handleCoursesChange}
                        options={allCourses}
                        placeholder="Search or scroll to select courses..."
                        required={false}
                    />
                    <div className="form-group">
                        <label htmlFor="review-comment">Your Review *</label>
                        <textarea
                            id="review-comment"
                            rows={4}
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            onFocus={scrollButtonsIntoView}
                            placeholder="Share your experience with this teacher..."
                            required
                            aria-required="true"
                        />
                    </div>
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
            </div>
        </div>
    );
};

export default ReviewFormModal;
