import React from 'react';
import Icon from './Icon';

interface ModalProps {
    onClose: () => void;
}

/** "About" dialog opened from the header. */
export const AboutModal: React.FC<ModalProps> = ({ onClose }) => (
    <div className="modal-overlay" onClick={() => onClose()}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="gradient-text modal-heading"><Icon name="book-open" size={22} /> About UMT Teacher Reviews</h3>
            <p>This platform allows students to write and read reviews about their teachers anonymously.</p>
            <hr />
            <p><strong>Version:</strong> 2.0</p>
            <button onClick={() => onClose()} className="modal-close-btn">Close</button>
        </div>
    </div>
);

/** "Contact us" dialog opened from the header. */
export const ContactModal: React.FC<ModalProps> = ({ onClose }) => (
    <div className="modal-overlay" onClick={() => onClose()}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="gradient-text modal-heading"><Icon name="mail" size={22} /> Contact Us</h3>
            <p>If you have any questions, need help, or want to give feedback, please send an email to:</p>
            <p><strong>umt.teacher.reviews@gmail.com</strong></p>
            <button onClick={() => onClose()} className="modal-close-btn">Close</button>
        </div>
    </div>
);
