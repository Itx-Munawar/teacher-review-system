# QA Testing Report: UMT Teacher Reviews

## 1. Executive Summary
The QA testing for the **UMT Teacher Reviews** application has been completed across both the frontend (Vercel) and backend (Render) environments. While the core functionality (viewing teachers, submitting reviews, and basic admin operations) is operational, the application suffers from **critical security vulnerabilities**, hardcoded configuration issues, and architectural flaws that must be addressed immediately before production use. The most severe issue is an unauthenticated backdoor in the admin setup endpoint that allows complete account takeover.

## 2. Critical Security Vulnerabilities
- **CRITICAL: Unauthenticated Admin Takeover:** The `POST /api/admin/setup` endpoint lacks any authentication. An attacker can pass any existing `username` and a new password, and the backend will execute `DELETE FROM admins WHERE username = ?` followed by `INSERT INTO admins`, completely taking over the admin account.
- **Insecure Token Storage:** The frontend stores the admin JWT in `localStorage` (`localStorage.setItem('admin_token', ...)`). This makes the application highly susceptible to Cross-Site Scripting (XSS) attacks, where malicious scripts could extract the token.
- **Unhashed Reset Tokens:** Password reset tokens are stored in plaintext in the database (`reset_token = ?`). If the database is compromised, attackers can use these tokens to reset admin passwords before they expire.
- **Weak Password Policy Enforcement:** The reset password logic only requires passwords to be 6 characters long (`newPassword.length < 6`), with no complexity requirements enforced by the backend.

## 3. Frontend (Vercel) Issues
- **Hardcoded Developer Defaults:** The frontend login screen explicitly leaks the default admin credentials to users in plaintext (`Default: admin / Admin@123`), encouraging attacks.
- **TypeScript Type Safety Compromised:** The React application heavily relies on the `any` type (e.g., `adminStats: any`, `reviewsForModeration: any[]`), defeating the purpose of TypeScript and increasing the risk of runtime crashes.
- **Inconsistent Search Rendering:** The search interface dynamically toggles between paginated teachers and unpaginated search results (`displayTeachers = isSearching ? searchResults : teachers;`), creating a jarring user experience and potential performance hitches if the search yields hundreds of results.
- **Suboptimal Auto-Logout Implementation:** The admin auto-logout relies on JavaScript `setTimeout`. If an admin has multiple tabs open, activity in one tab does not reset the timer in the others, leading to abrupt local state logouts.

## 4. Backend (Render) Issues
- **Hardcoded Production URLs:** The password reset email logic hardcodes the reset link to local development: `` const resetLink = `http://localhost:3000/reset-password?token=${resetToken}`; ``. This completely breaks the reset functionality in the Vercel production environment.
- **Memory Leak in Custom Cache:** The backend implements a custom in-memory cache using `new Map()` without any size bounds (eviction only occurs via TTL checking on read, not actively deleting old keys). This will lead to an Out-Of-Memory (OOM) crash on Render under heavy traffic.
- **Unpaginated Admin Endpoints:** The `GET /api/admin/reviews` endpoint returns all reviews unconditionally. As the database grows, this will cause significant latency, heavy database load, and eventual request timeouts.
- **Lack of Multi-Instance Support:** Cache invalidation (`invalidateCache`) only works in memory. If the backend scales to multiple instances on Render, cache states will become desynchronized across instances.

## 5. Codebase & Dependency Issues
- **Missing Environment Variable Validation:** The server initializes without checking if critical environment variables (like `JWT_SECRET`, `EMAIL_USER`, or `EMAIL_PASS`) exist, which will lead to unpredictable runtime crashes instead of failing cleanly during startup.
- **Unprotected Search Endpoint:** While `reviewLimiter` and `loginLimiter` are implemented, the `GET /api/teachers/search` endpoint has no rate limiting, making the database vulnerable to query-based Denial of Service (DoS) attacks.
- **Improper Database Error Exposure:** Unhandled database errors are caught but sometimes surface internal details, although most are caught with a generic `500 Server error`. However, strict validation relies solely on `express-validator` without deep data integrity checks in MySQL.

## 6. Recommendations & Next Steps

### Immediate Actions (Hotfixes)
1. **Remove or Secure the Admin Setup Endpoint:** Immediately delete or comment out the `POST /api/admin/setup` route, or require a highly secure, offline-generated secret key to access it.
2. **Fix Password Reset Link:** Update the password reset logic in `server.js` to use an environment variable (e.g., `process.env.FRONTEND_URL`) instead of `http://localhost:3000`.
3. **Remove Hardcoded Credentials:** Remove the visible `admin / Admin@123` helper text from `App.tsx` login component.

### Short-Term Refactoring
4. **Implement `HttpOnly` Cookies:** Migrate JWT storage from `localStorage` to secure, `HttpOnly`, `SameSite=Strict` cookies to mitigate XSS risks.
5. **Paginate Admin Routes:** Implement pagination for `GET /api/admin/reviews` and `GET /api/teachers/search` to ensure stable performance as the application scales.
6. **Apply Global Rate Limiting:** Extend rate limiting to search and other heavily accessed public endpoints.

### Long-Term Architectural Improvements
7. **Replace Custom Cache:** Swap the unbounded `Map()` cache with an established library like `lru-cache`, or implement Redis if multi-instance scaling is required.
8. **Enforce TypeScript Strictness:** Audit the frontend codebase, remove `any` types, and properly define interfaces for admin components and API responses.
9. **Improve Password Security:** Enforce stronger password requirements (regex for numbers, symbols, uppercase) and hash reset tokens before storing them in the database.
