import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api';
import { extractResetToken } from '../utils/resetToken';

const ResetPassword: React.FC = () => {
    // Read the token exactly once, on purpose: it is wiped from the address bar
    // on mount (see the effect below), so a later re-render must not lose it.
    const [token] = useState(() => extractResetToken(window.location.hash, window.location.search));
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        // A reset token sitting in the URL can be copied, screenshotted or
        // autocompleted later. It has already been read into state, so drop it.
        window.history.replaceState(null, '', window.location.pathname);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirm) {
            setError('Passwords do not match');
            return;
        }
        if (password.length < 10) {
            setError('Password must be at least 10 characters');
            return;
        }
        if (new TextEncoder().encode(password).length > 72) {
            setError('Password must be at most 72 bytes (special characters count as more than one)');
            return;
        }
        try {
            const res = await api.post('/admin/reset-password', { token, newPassword: password });
            setMessage(res.data.message);
            setPassword('');
            setConfirm('');
            setTimeout(() => navigate('/'), 3000);
        } catch (err) {
            const axiosErr = err as { response?: { data?: { error?: string } } };
            setError(axiosErr.response?.data?.error || 'Reset failed');
        }
    };

    if (!token) return <div className="error-message">Invalid or missing token.</div>;

    return (
        <div className="login-form-container">
            <div className="login-form">
                <h2>Reset Password</h2>
                <form onSubmit={handleSubmit}>
                    <input
                        type="password"
                        placeholder="New Password"
                        autoComplete="new-password"
                        maxLength={72}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />
                    <input
                        type="password"
                        placeholder="Confirm Password"
                        autoComplete="new-password"
                        maxLength={72}
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        required
                    />
                    {message && <div className="success-message">{message}</div>}
                    {error && <div className="error-message">{error}</div>}
                    <button type="submit">Reset Password</button>
                </form>
            </div>
        </div>
    );
};

export default ResetPassword;
