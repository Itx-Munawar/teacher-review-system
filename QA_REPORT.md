# QA Testing Report: UMT Teacher Reviews

Last verified against the code: 2026-10-25.

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

## Review pass: 2026-10-25

A second full review of the repository and the live deployment produced the
following fixes.

### Backend

- `GET /api/questions` now pages over questions and fetches their answers in a
  second query. Paging the question × answer join could split a question with
  many answers across pages and made `totalPages` disagree with the rendered
  count.
- Teacher search escapes `%`, `_`, and `\` before building `LIKE` patterns, so
  `q=_` no longer returns the whole table.
- Answers can only be posted to approved questions (`is_approved = 1`).
- Added `DELETE /api/admin/answers/:id` (admin + CSRF + audit log) so a
  moderated answer can be removed instead of only edited.
- `passwordProblem` rejects passwords longer than 72 bytes, matching bcrypt's
  truncation limit.
- `JWT_SECRET` must be at least 32 characters or the server refuses to start.
- Audit-log IPs are stored as a keyed HMAC (`sha256:` prefix, 32 hex chars), and
  rows older than `AUDIT_LOG_RETENTION_DAYS` (default 90) are pruned on boot and
  daily.
- `sitemap.xml` no longer lists `/about` and `/contact`, which have no route and
  were rendering a duplicate homepage.

### Frontend

- Department pages gained "Load more" pagination; previously only the first 20
  of up to 289 teachers were reachable.
- Search requests from the URL restore and the admin panel pass `limit=50`
  instead of fetching every match.
- Admin Q&A rows have a Delete button wired to the new endpoint.
- Password reset enforces the 72-byte limit client-side and caps inputs at 72.
- `/about` redirects permanently to `/` on Vercel; `/contact` is now a real page.
- Privacy Policy documents hashed audit IPs and the 90-day retention.

## Phase 1 follow-up (2026-10-25, branch `review/2026-10-phase1`)

Roadmap: `ROADMAP.md`.

### SEO

- Per-route canonical URLs via `frontend/src/utils/seo.ts`; previously every
  route kept the homepage canonical from `index.html`, so `/questions` and the
  legal pages could not rank.
- `/admin`, unknown teacher IDs, and empty department pages are now
  `noindex, nofollow`. Verified in a headless browser: a valid teacher and
  department return `index, follow`; a bogus ID/department returns `noindex`.
- `sitemap.xml` uses real `lastmod` values (last approved review, last teacher
  added) instead of stamping every URL with today's date, and lists
  `/questions` and `/contact`.
- Removed a duplicated `<meta name="robots">` tag that the first pass added to
  `index.html` twice.

### Product and build

- `/contact` is a real page, linked from both footers, and the PWA search
  shortcut points at `/?search=` instead of `/?search=teachers`.
- Removed the "Sort: Newest" option; the API never returned a date for it, so it
  silently behaved like name order.
- `npm run build` works on Windows (`cross-env CI=false`).

### Backend

- `/api/ready` checks MySQL (`SELECT 1`, 2.5 s timeout, 503 on failure);
  `/api/health` remains process-only so a DB blip does not restart the service.
- Added `(department, name)` on `teachers` and `(is_approved, created_at)` on
  `questions` through the schema bootstrap (idempotent) and `schema.sql`.
- Graceful SIGTERM/SIGINT shutdown closes the HTTP server and MySQL pool.

### Tooling and documentation

- GitHub Actions CI (backend syntax + tests; frontend types, tests, build) and
  Dependabot for npm and Actions.
- README documents the health/readiness split and a `mysqldump` backup/restore
  runbook.
- `.env.example` blanks `ADMIN_SETUP_KEY` by default and documents the JWT
  length requirement.

