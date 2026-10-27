// Sends real JavaScript errors from visitors' browsers to the backend, where
// they are listed in the admin Errors tab (and emailed, at most hourly).
// Network/API failures are not reported: the server already sees those.

import api from '../services/api';

const MAX_REPORTS_PER_PAGE = 5;
const sent = new Set<string>();
let installed = false;

const IGNORED = [
    /^Script error\.?$/i,
    /ResizeObserver loop/i,
    /extension:\/\//i,
    /Network Error/i,
    /Failed to fetch/i,
    /Load failed/i,
    /dynamically imported module/i,
    /Importing a module script failed/i,
    /AbortError|canceled|cancelled/i,
];

interface ReportInput {
    message: string;
    stack?: string;
}

const isAxiosError = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && (value as { isAxiosError?: boolean }).isAxiosError === true;

const toReport = (value: unknown): ReportInput | null => {
    if (isAxiosError(value)) return null;
    if (value instanceof Error) return { message: `${value.name}: ${value.message}`, stack: value.stack };
    if (typeof value === 'string') return { message: value };
    return null;
};

export const reportError = (value: unknown, extraStack?: string): void => {
    try {
        const report = toReport(value);
        if (!report || !report.message) return;
        if (IGNORED.some((re) => re.test(report.message) || (report.stack ? re.test(report.stack) : false))) return;
        if (sent.size >= MAX_REPORTS_PER_PAGE || sent.has(report.message)) return;
        sent.add(report.message);
        const stack = [report.stack, extraStack].filter(Boolean).join('\n--- component stack ---\n');
        api.post('/client-errors', {
            message: report.message.slice(0, 500),
            stack: stack.slice(0, 6000) || undefined,
            url: window.location.href.slice(0, 300),
        }).catch(() => undefined);
    } catch {
        // Reporting must never cause another error.
    }
};

/** Hook window errors and unhandled promise rejections (call once at startup). */
export const installErrorReporter = (): void => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    window.addEventListener('error', (event) => {
        // Resource load errors (img/script tags) have no `error` object.
        if (!event.error && !event.message) return;
        reportError(event.error || event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
        reportError(event.reason);
    });
};

/** For tests. */
export const _resetErrorReporter = (): void => {
    sent.clear();
};
