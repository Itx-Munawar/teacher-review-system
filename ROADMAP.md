# Roadmap: review follow-ups

Status key: **Done** · **In progress** · **Planned** · **Needs input** (account, credential, or product decision)

## Phase 1 — SEO correctness and quick fixes (done)

| # | Step | Status |
| --- | --- | --- |
| 1 | Per-route canonical URLs; `noindex` for `/admin` and empty pages | Done |
| 2 | Sitemap: real `lastmod`, add `/questions` | Done |
| 3 | Fix PWA shortcut (`/?search=teachers` → `/?search=`) | Done |
| 4 | Make `npm run build` work on Windows (`cross-env`) | Done |
| 5 | README/env consistency (email vars are required; JWT length) | Done |
| 6 | Blank `ADMIN_SETUP_KEY` in `.env.example` | Done |
| 7 | `/api/ready` that checks the database | Done |
| 8 | Real `/contact` page instead of redirecting home | Done |
| 9 | Remove the meaningless "Newest" sort | Done |
| 10 | Composite indexes for department and Q&A queries | Done |
| 11 | `noindex` soft-404s (empty department, unknown teacher) | Done |
| 12 | Graceful shutdown on SIGTERM/SIGINT | Done |
| 13 | CI workflow + Dependabot | Done |
| 14 | Backup/restore runbook in README | Done |

## Phase 2 — Admin and observability (done)

| # | Step | Status |
| --- | --- | --- |
| 15 | Audit-log tab in the admin panel | Done |
| 16 | Daily pending-moderation digest email | Done |
| 17 | Zero-result search logging | Done |
| 18 | Structured request logging | Done |

## Phase 3 — Security (done)

| # | Step | Status |
| --- | --- | --- |
| 19 | Admin TOTP two-factor authentication | Done |
| 20 | Error monitoring (Sentry) | Needs input — DSN |
| 21 | Uptime monitor / keep-warm ping | Needs input — external account |

- `POST /api/admin/login` now accepts an optional `totp_code`. When the account
  has a TOTP secret, the endpoint returns `{ requires_totp: true }` instead of
  a session cookie, and the frontend asks the user for the code in the login
  form before proceeding.
- New endpoints: `POST /api/admin/2fa/setup` (generates a fresh secret and
  returns a provisioning URI), `POST /api/admin/2fa/enable` (confirms the
  enrollment by verifying a live code), `POST /api/admin/2fa/disable` (turns
  2FA off; logged in audit). The schema bootstrap adds the `totp_secret` and
  `totp_enabled` columns if they are missing.
- `GET /api/admin/me` now includes `totp_enabled` so the security tab can
  update immediately after a change.
- Frontend: login form shows the TOTP field when 2FA is active; a **Security**
  tab in the admin panel walks through QR code scanning, manual secret entry,
  confirmation, and (optionally) disabling 2FA.
- A bare `2FA_FAILED` action is logged when a wrong code is submitted.

## Phase 4 follow-up (in progress)

| # | Step | Status |
| --- | --- | --- |
| 22 | Course pages (`/course/:name`) | In progress |
| 23 | Prerendered social/OG tags for teacher and department pages | Deferred |
| 24 | CRA → Vite migration | In progress |

## Already handled

- Duplicate-review guard (normalised text per teacher) already exists in
  `POST /api/reviews`; no change needed.
- Google Search Console and Bing verification tags already exist.
- Source maps are not publicly served (403).
- Admin is already `Disallow`ed in `robots.txt`.

## External prerequisites

- Item 20 needs a Sentry DSN (or another error-tracking provider).
- Item 21 needs an uptime-monitor account and a URL to ping (use `/api/ready`).
- Backups depend on the database provider; the runbook documents the manual
  `mysqldump` path that works today.
