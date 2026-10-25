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

## Phase 2 — Admin and observability

| # | Step | Status |
| --- | --- | --- |
| 15 | Audit-log tab in the admin panel | Planned |
| 16 | Daily pending-moderation digest email | Planned |
| 17 | Zero-result search logging | Planned |
| 18 | Structured request logging | Planned |

## Phase 3 — Security

| # | Step | Status |
| --- | --- | --- |
| 19 | Admin TOTP two-factor authentication | Planned |
| 20 | Error monitoring (Sentry) | Needs input — DSN |
| 21 | Uptime monitor / keep-warm ping | Needs input — external account |

## Phase 4 — Product and architecture

| # | Step | Status |
| --- | --- | --- |
| 22 | Course pages (`/course/:name`) | Planned |
| 23 | Prerendered social/OG tags for teacher and department pages | Planned |
| 24 | CRA → Vite migration | Planned |

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
