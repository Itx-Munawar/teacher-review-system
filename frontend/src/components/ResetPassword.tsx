import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../services/api';

const ResetPassword: React.FC = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const navigate = useNavigate();
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirm) {
            setError('Passwords do not match');
            return;
        }
        if (password.length < 6) {
            setError('Password must be at least 6 characters');
            return;
        }
        try {
            const res = await api.post('/admin/reset-password', { token, newPassword: password });
            setMessage(res.data.message);
            setTimeout(() => navigate('/'), 3000);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Reset failed');
        }
    };

    if (!token) return <div className="error-message">Invalid or missing token.</div>;

    return (
        <div className="login-form-container">
            <div className="login-form">
                <h2>Reset Password</h2>
                <form onSubmit={handleSubmit}>
                    <input type="password" placeholder="New Password" value={password} onChange={(e) => setPassword(e.target.value)} required />
                    <input type="password" placeholder="Confirm Password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
                    {message && <div className="success-message">{message}</div>}
                    {error && <div className="error-message">{error}</div>}
                    <button type="submit">Reset Password</button>
                </form>
            </div>
        </div>
    );
};

export default ResetPassword;