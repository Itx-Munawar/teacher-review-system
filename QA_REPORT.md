# QA Testing Report: UMT Teacher Reviews

Last verified against the code: 2026-10-17.

This report started as a QA audit of the frontend (Vercel) and backend (Render). Every finding from that audit has since been re-checked against the current code. The table below shows where each one stands.

## Status of findings

| Finding | Severity | Status |
| --- | --- | --- |
| Unauthenticated `POST /api/admin/setup` allowed admin takeover | Critical | Fixed. The route requires an `ADMIN_SETUP_KEY` env var plus an `x-setup-secret` header (constant-time compare) and returns 404 when the key is unset. It also no longer returns raw error messages. |
| Admin JWT stored in `localStorage` | High | Fixed. The token is now an `httpOnly` cookie, with CSRF validation on state-changing routes. |
| Reset tokens stored in plaintext | High | Fixed. Only a SHA-256 hash is stored, and the raw token exists only in the emailed link. |
| Weak password policy (6 characters) | Medium | Fixed. Reset and setup require at least 10 characters with at least one letter and one digit, enforced in both backend and frontend. |
| Default admin credentials shown on the login screen | High | Fixed. The hint is removed from the UI. Anyone who ever used the old default must have rotated the password. |
| Reset link hardcoded to `localhost:3000` | High | Fixed. It now uses the `FRONTEND_URL` env var. |
| Unbounded in-memory cache | Medium | Fixed. It now uses `lru-cache`. |
| Unpaginated admin reviews endpoint | Medium | Fixed. It is paginated, and page and limit are clamped to valid values. |
| No rate limit on search | Medium | Fixed. `searchLimiter` is applied to the search route. |
| Missing env var validation | Medium | Fixed. The server checks required variables at startup. |
| Public diagnostic endpoints (`/api/schema-status`, `/api/db-test`, `/api/ensure-courses`) leaked raw errors, and `ensure-courses` ran an `ALTER TABLE` from an unauthenticated GET | Medium | Fixed. All three routes were removed; schema setup happens at server startup. |
| Cache not shared across instances | Low | Open (accepted). This is only a problem if the backend scales beyond one instance. |
| Frontend `any` types | Low | Fixed in `App.tsx` (API response, JSON-LD, review payload) and in the install prompt; remaining `as any` uses are limited to test helpers. |
| Admin auto-logout timer not synced across tabs | Low | Fixed server-side. Admin sessions now slide on activity and expire in the backend after `ADMIN_SESSION_MINUTES` (default 30); a stale tab's next request gets 401/403. |

## Notes

- Existing password reset links stop working when the hashed-token change is deployed. They expire after one hour anyway.

## Hardening pass (2026-10-25, branch `hardening/2026-10-review`)

A follow-up code review found the items below. All were implemented and the
backend (54 tests) and frontend (63 tests) suites plus `tsc --noEmit` pass.

### Backend

- Admin sessions slide on activity and are capped by `ADMIN_SESSION_MINUTES`
  (default 30); the cookie lifetime matches the JWT.
- Login lockout is soft: wrong passwords are recorded and alerted on, but a
  correct password always works, so anonymous guessing cannot lock out the only
  admin. Per-IP login rate limiting already covers brute force.
- Forgot-password returns one generic message for every address, and email is
  fire-and-forget, removing the account-enumeration and SMTP-timing oracles.
- Shared password rule (`passwordProblem`) uses 10+ characters with a letter
  and a digit for both reset and setup.
- Every list endpoint clamps `page`/`limit` (`clampInt`); search terms are
  capped at 100 characters; teacher/question/review/report IDs are validated.
- Teacher detail no longer runs `SHOW COLUMNS`/`ALTER TABLE`; reviews are
  paginated (`review_page`, `review_limit`, default 50, max 100) and include
  `review_pagination`.
- Public teacher lists are sent `private, no-store` when an admin cookie is
  present, and delete/update review invalidates the teacher cache.
- Review deletion removes its `review_reports` rows; teacher deletion is a
  transaction covering reports, reviews, answers, questions and the teacher.
- New `GET /api/admin/reports` and `PUT /api/admin/reports/:id` (open, resolved,
  dismissed); stats include `open_reports`, and admin teacher detail includes
  `open_reports` per review.
- Moderation queues show sensitive/bias flagged rows first.
- Report submission is limited to approved reviews.
- Content-filter sweeps paginate by id (500 rows/batch) and yield to the event
  loop, instead of loading entire tables and blocking health checks.
- Removed dead `invalidateCache('questions' | 'courses')` calls and the
  hardcoded deployment hostname (sitemap/robots/CORS derive from
  `FRONTEND_URL`).
- Added `npm test` (`node --test`) and documented `ADMIN_SESSION_MINUTES`.

### Frontend

- Shared `utils/courses.ts` decodes JSON/array/plain-text/Buffer-shaped course
  values without Node's `Buffer` global; used by the public and admin views.
- Teacher profiles use the server's `total_reviews` instead of the loaded page
  length, and offer "Load more reviews".
- Admin panel has a Reports tab with status filter, resolve/dismiss/reopen, and
  a header badge for open reports.
- 401/403 session expiry ignores the login request, and logout is guarded
  against concurrent 401s.
- `handleSubmitReview` only reloads admin data when an admin is logged in;
  login no longer fetches admin data twice.
- Removed the last `any` types in `App.tsx` (API response, JSON-LD, payload).
- Deleted the scraped `backend/faculty.aspx`, dead `setup*.js` scripts, and the
  unused repository-root `package.json`/`package-lock.json`; added a root
  `README.md`.
