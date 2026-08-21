import React, { useEffect, useState } from 'react';
import Icon from './Icon';

export interface ToastItem {
    id: number;
    message: string;
    type: 'success' | 'error' | 'info';
}

interface ToastProps {
    toast: ToastItem;
    onDismiss: (id: number) => void;
    duration?: number;
}

const Toast: React.FC<ToastProps> = ({ toast, onDismiss, duration = 4000 }) => {
    const [progress, setProgress] = useState(100);
    const [isExiting, setIsExiting] = useState(false);

    useEffect(() => {
        const startTime = Date.now();
        const interval = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const remaining = Math.max(0, 100 - (elapsed / duration) * 100);
            setProgress(remaining);
            if (remaining <= 0) {
                clearInterval(interval);
                setIsExiting(true);
                setTimeout(() => onDismiss(toast.id), 300);
            }
        }, 50);

        return () => clearInterval(interval);
    }, [toast.id, duration, onDismiss]);

    const handleDismiss = () => {
        setIsExiting(true);
        setTimeout(() => onDismiss(toast.id), 300);
    };

    const icons: Record<string, 'check' | 'x' | 'info'> = {
        success: 'check',
        error: 'x',
        info: 'info',
    };

    return (
        <div
            className={`toast toast-${toast.type} ${isExiting ? 'toast-exit' : 'toast-enter'}`}
            role="status"
            aria-live="polite"
        >
            <div className="toast-icon">
                <Icon name={icons[toast.type]} size={18} />
            </div>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-dismiss" onClick={handleDismiss} aria-label="Dismiss">
                ×
            </button>
            <div className="toast-progress">
                <div
                    className="toast-progress-bar"
                    style={{ width: `${progress}%` }}
                />
            </div>
        </div>
    );
};

interface ToastHostProps {
    toasts: ToastItem[];
    onDismiss: (id: number) => void;
}

export const ToastHost: React.FC<ToastHostProps> = ({ toasts, onDismiss }) => (
    <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
            <Toast key={t.id} toast={t} onDismiss={onDismiss} />
        ))}
    </div>
);

export default Toast;
