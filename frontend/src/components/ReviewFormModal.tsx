import React, { useEffect } from 'react';
import Icon from './Icon';
import SearchableDropdown from './SearchableDropdown';
import { useFocusTrap } from '../hooks/useFocusTrap';
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
    reviewCourse: string;
    setReviewCourse: (v: string) => void;
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
    reviewCourse,
    setReviewCourse,
    reviewError,
    submitting,
    onSubmit,
    onClose,
}) => {
    const trapRef = useFocusTrap(true);

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
                <form onSubmit={onSubmit} aria-labelledby="review-modal-title">
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
                        label="Course"
                        id="review-course"
                        value={reviewCourse}
                        onChange={setReviewCourse}
                        options={UMT_COURSES}
                        placeholder="Search for a course..."
                        required={false}
                    />
                    <div className="form-group">
                        <label htmlFor="review-comment">Your Review *</label>
                        <textarea
                            id="review-comment"
                            rows={4}
                            value={reviewComment}
                            onChange={(e) => setReviewComment(e.target.value)}
                            placeholder="Share your experience with this teacher..."
                            required
                            aria-required="true"
                        />
                    </div>
                    <div className="form-buttons">
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
                </form>
            </div>
        </div>
    );
};

export default ReviewFormModal;
