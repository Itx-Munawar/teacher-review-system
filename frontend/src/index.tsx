import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';
import App from './App';
import { registerServiceWorker } from './services/registerServiceWorker';

// Secondary routes load on demand; the home/teacher view (App) stays in the main bundle.
const ForgotPassword = lazy(() => import('./components/ForgotPassword'));
const ResetPassword = lazy(() => import('./components/ResetPassword'));
const PrivacyPolicy = lazy(() => import('./components/PrivacyPolicy'));
const TermsOfUse = lazy(() => import('./components/TermsOfUse'));
const DmcaPolicy = lazy(() => import('./components/DmcaPolicy'));
const Contact = lazy(() => import('./components/Contact'));
const CoursePage = lazy(() => import('./components/CoursePage'));
const DepartmentPage = lazy(() => import('./components/DepartmentPage'));

// After a deploy, a tab opened before it may ask for a chunk file that no
// longer exists. Reload once to pick up the new build instead of showing an error.
window.addEventListener('vite:preloadError', (event) => {
    const key = 'chunk-reload-at';
    const last = Number(sessionStorage.getItem(key) || 0);
    if (Date.now() - last > 10_000) {
        event.preventDefault();
        sessionStorage.setItem(key, String(Date.now()));
        window.location.reload();
    }
});

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
root.render(
    <React.StrictMode>
        <BrowserRouter>
            <Suspense fallback={<div className="loading" role="status">Loading…</div>}>
            <Routes>
                <Route path="/forgot-password" element={<ForgotPassword />} />
                <Route path="/reset-password" element={<ResetPassword />} />
                <Route path="/privacy" element={<PrivacyPolicy />} />
                <Route path="/terms" element={<TermsOfUse />} />
                <Route path="/dmca" element={<DmcaPolicy />} />
                <Route path="/contact" element={<Contact />} />
                <Route path="/course/:name" element={<CoursePage />} />
                <Route path="/department/:name" element={<DepartmentPage />} />
                <Route path="/teacher/:id" element={<App />} />
                <Route path="*" element={<App />} />
            </Routes>
            </Suspense>
        </BrowserRouter>
    </React.StrictMode>
);

registerServiceWorker();
