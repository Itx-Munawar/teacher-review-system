import React, { useState } from 'react';
import { submitReview } from '../services/api';

interface Props {
    teacherId: number;
    teacherName: string;
    onSuccess: () => void;
    onCancel: () => void;
}

const ReviewForm: React.FC<Props> = ({ teacherId, teacherName, onSuccess, onCancel }) => {
    const [rating, setRating] = useState(5);
    const [comment, setComment] = useState('');
    const [userName, setUserName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!comment.trim()) {
            setError('Please write a review');
            return;
        }
        
        setSubmitting(true);
        setError('');
        
        try {
            await submitReview({
                teacher_id: teacherId,
                rating,
                comment: comment.trim(),
                user_name: userName.trim() || 'Anonymous'
            });
            onSuccess();
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to submit review');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="review-form-container">
            <h3 className="review-form-title">✏️ Write a Review for {teacherName}</h3>
            
            {error && <div className="error-message">{error}</div>}
            
            <form onSubmit={handleSubmit}>
                <div className="form-group">
                    <label>⭐ Rating (1-5)</label>
                    <select value={rating} onChange={(e) => setRating(Number(e.target.value))} required>
                        <option value="5">5 Stars - Excellent ⭐⭐⭐⭐⭐</option>
                        <option value="4">4 Stars - Very Good ⭐⭐⭐⭐</option>
                        <option value="3">3 Stars - Average ⭐⭐⭐</option>
                        <option value="2">2 Stars - Poor ⭐⭐</option>
                        <option value="1">1 Star - Very Poor ⭐</option>
                    </select>
                </div>
                
                <div className="form-group">
                    <label>👤 Your Name (optional)</label>
                    <input type="text" value={userName} onChange={(e) => setUserName(e.target.value)} placeholder="Leave blank to post anonymously" />
                </div>
                
                <div className="form-group">
                    <label>💬 Your Review *</label>
                    <textarea rows={4} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Share your experience with this teacher..." required />
                </div>
                
                <div className="form-buttons">
                    <button type="button" onClick={onCancel} className="btn-cancel">Cancel</button>
                    <button type="submit" disabled={submitting} className="btn-submit">{submitting ? 'Submitting...' : 'Submit Review'}</button>
                </div>
            </form>
        </div>
    );
};

export default ReviewForm;