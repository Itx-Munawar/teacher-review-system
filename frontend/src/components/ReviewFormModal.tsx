import React from 'react';
import Icon from './Icon';
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
}) => (
    <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content review-sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Write a review for ${selectedTeacher.name}`}>
            <h3 className="review-form-title">
                <Icon name="edit" size={20} /> Write a Review for {selectedTeacher.name}
            </h3>
            {reviewError && <div className="error-message">{reviewError}</div>}
            <form onSubmit={onSubmit}>
                <div className="form-group">
                    <label>Your Name (optional)</label>
                    <input type="text" value={reviewUserName} onChange={(e) => setReviewUserName(e.target.value)} placeholder="Leave blank to post anonymously" aria-label="Your name (optional)" />
                </div>
                <div className="form-group">
                    <label>Your Review *</label>
                    <textarea rows={4} value={reviewComment} onChange={(e) => setReviewComment(e.target.value)} placeholder="Share your experience with this teacher..." required aria-label="Your review" />
                </div>
                <div className="form-buttons">
                    <button type="button" onClick={onClose} className="btn-cancel">Cancel</button>
                    <button type="submit" disabled={submitting} className="btn-submit">
                        {submitting ? <><span className="spinner-small"></span> Submitting...</> : 'Submit Review'}
                    </button>
                </div>
            </form>
        </div>
    </div>
);

export default ReviewFormModal;
