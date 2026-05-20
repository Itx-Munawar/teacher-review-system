import React, { useState } from 'react';
import api from '../services/api';

const ForgotPassword: React.FC = () => {
    const [email, setEmail] = useState('');
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setMessage('');
        setError('');
        try {
            const res = await api.post('/admin/forgot-password', { email });
            setMessage(res.data.message || 'Check your email for reset link.');
        } catch (err: any) {
            setError(err.response?.data?.error || 'Something went wrong.');
        }
    };

    return (
        <div className="login-form-container">
            <div className="login-form">
                <h2>Forgot Password</h2>
                <form onSubmit={handleSubmit}>
                    <input type="email" placeholder="Admin Email" value={email} onChange={(e) => setEmail(e.target.value)} required />
                    {message && <div className="success-message">{message}</div>}
                    {error && <div className="error-message">{error}</div>}
                    <button type="submit">Send Reset Link</button>
                </form>
                <p><a href="/admin">Back to Login</a></p>
            </div>
        </div>
    );
};

export default ForgotPassword;