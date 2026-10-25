import React, { memo } from 'react';

export interface LoginFormProps {
    adminUsername: string;
    setAdminUsername: (v: string) => void;
    adminPassword: string;
    setAdminPassword: (v: string) => void;
    adminError: string;
    onLogin: (e: React.FormEvent) => void;
    /** When true, also show the TOTP code field (2FA is enabled on this account). */
    requires_totp?: boolean;
    admin_totp_code: string;
    setAdmin_totp_code: (v: string) => void;
}

const LoginForm = memo(({
    adminUsername,
    setAdminUsername,
    adminPassword,
    setAdminPassword,
    adminError,
    onLogin,
    requires_totp = false,
    admin_totp_code,
    setAdmin_totp_code
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
                {requires_totp && (
                    <>
                        <p style={{ fontSize: '0.85rem', color: '#475569', margin: '8px 0' }}>
                            This account uses two-factor authentication. Enter the 6-digit code from your authenticator app.
                        </p>
                        <input
                            type="text"
                            placeholder="TOTP code"
                            aria-label="TOTP code"
                            autoComplete="one-time-code"
                            maxLength={8}
                            pattern="[0-9]{6}"
                            value={admin_totp_code}
                            onChange={(e) => setAdmin_totp_code(e.target.value.replace(/\D/g, ''))}
                            required
                        />
                    </>
                )}
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
