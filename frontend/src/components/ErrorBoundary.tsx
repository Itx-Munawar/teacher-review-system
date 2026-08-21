import React, { Component, ErrorInfo, ReactNode } from 'react';
import Icon from './Icon';

interface Props {
    children: ReactNode;
    /** Optional custom fallback UI */
    fallback?: ReactNode;
    /** Called when an error is caught */
    onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
    constructor(props: Props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('ErrorBoundary caught an error:', error, errorInfo);
        this.props.onError?.(error, errorInfo);
    }

    handleReset = () => {
        this.setState({ hasError: false, error: null });
    };

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) {
                return this.props.fallback;
            }

            return (
                <div className="error-boundary">
                    <div className="error-boundary-content">
                        <Icon name="info" size={48} />
                        <h2>Something went wrong</h2>
                        <p className="error-boundary-message">
                            An unexpected error occurred. Please try again.
                        </p>
                        {this.state.error && (
                            <details className="error-boundary-details">
                                <summary>Error details</summary>
                                <pre>{this.state.error.message}</pre>
                            </details>
                        )}
                        <div className="error-boundary-actions">
                            <button onClick={this.handleReset} className="btn-submit">
                                Try Again
                            </button>
                            <button onClick={() => window.location.reload()} className="btn-cancel">
                                Reload Page
                            </button>
                        </div>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
