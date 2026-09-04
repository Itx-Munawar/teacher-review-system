import React, { useEffect } from 'react';
import Icon from './Icon';
import { useFocusTrap } from '../hooks/useFocusTrap';
import type { TeacherDetail } from '../types';

interface ReviewFormModalProps {
    selectedTeacher: TeacherDetail;
    reviewComment: string;
    setReviewComment: (v: string) => void;
    reviewUserName: string;
    setReviewUserName: (v: string) => void;
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
