import React, { memo } from 'react';

export interface LoginFormProps {
    adminUsername: string;
    setAdminUsername: (v: string) => void;
    adminPassword: string;
    setAdminPassword: (v: string) => void;
    adminError: string;
    onLogin: (e: React.FormEvent) => void;
}

const LoginForm = memo(({
    adminUsername,
    setAdminUsername,
    adminPassword,
    setAdminPassword,
    adminError,
    onLogin
}: LoginFormProps) => (
    <div className="login-form-container">
        <div className="login-form">
            <h2 className="gradient-text">Admin Login</h2>
            <form onSubmit={onLogin}>
                <input
                    type="text"
                    placeholder="Username"
                    aria-label="Username"
                    autoComplete="username"
                    maxLength={60}
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    required
                    autoFocus
                />
                <input
                    type="password"
                    placeholder="Password"
                    aria-label="Password"
                    autoComplete="current-password"
                    maxLength={200}
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    required
                />
                {adminError && <div className="error-message">{adminError}</div>}
                <button type="submit">Login</button>
            </form>
            <p style={{ textAlign: 'center', marginTop: '15px' }}>
                <a href="/forgot-password" style={{ color: '#7a5320' }}>Forgot Password?</a>
            </p>
        </div>
    </div>
));

export default LoginForm;
