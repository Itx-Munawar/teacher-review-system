# QA Testing Report: UMT Teacher Reviews

Last verified against the code: 2026-10-17.

This report started as a QA audit of the frontend (Vercel) and backend (Render). Every finding from that audit has since been re-checked against the current code. The table below shows where each one stands.

## Status of findings

| Finding | Severity | Status |
| --- | --- | --- |
| Unauthenticated `POST /api/admin/setup` allowed admin takeover | Critical | Fixed. The route requires an `ADMIN_SETUP_KEY` env var plus an `x-setup-secret` header (constant-time compare) and returns 404 when the key is unset. It also no longer returns raw error messages. |
| Admin JWT stored in `localStorage` | High | Fixed. The token is now an `httpOnly` cookie, with CSRF validation on state-changing routes. |
| Reset tokens stored in plaintext | High | Fixed. Only a SHA-256 hash is stored, and the raw token exists only in the emailed link. |
| Weak password policy (6 characters) | Medium | Partly fixed. Password reset now requires at least 10 characters. Complexity rules are not enforced. |
| Default admin credentials shown on the login screen | High | Fixed. The hint is removed from the UI. Anyone who ever used the old default must have rotated the password. |
| Reset link hardcoded to `localhost:3000` | High | Fixed. It now uses the `FRONTEND_URL` env var. |
| Unbounded in-memory cache | Medium | Fixed. It now uses `lru-cache`. |
| Unpaginated admin reviews endpoint | Medium | Fixed. It is paginated, and page and limit are clamped to valid values. |
| No rate limit on search | Medium | Fixed. `searchLimiter` is applied to the search route. |
| Missing env var validation | Medium | Fixed. The server checks required variables at startup. |
| Public diagnostic endpoints (`/api/schema-status`, `/api/db-test`, `/api/ensure-courses`) return raw error messages, and `ensure-courses` runs an `ALTER TABLE` from an unauthenticated GET | Medium | Open. These should be removed or put behind admin auth. |
| Cache not shared across instances | Low | Open (accepted). This is only a problem if the backend scales beyond one instance. |
| Frontend `any` types | Low | Open. A handful remain in `App.tsx`, `AdminPanel.tsx` and `TeacherDetailView.tsx`. |
| Admin auto-logout timer not synced across tabs | Low | Open. |

## Notes

- Existing password reset links stop working when the hashed-token change is deployed. They expire after one hour anyway.
- Frontend password-length hints should be updated to say 10 characters to match the backend.
