# UMT Teacher Reviews

Anonymous, moderated teacher reviews for the University of Management and
Technology (Lahore), with a Q&A board, reader reports, and an admin panel for
moderation.

## Structure

```
backend/    Express + MySQL API
  server.js   entry point: start HTTP server, background jobs, shutdown
  app.js      Express app: security middleware, CORS, logging, route mounting
  config.js   env validation and constants        state.js  shared schema flags
  routes/     public, chat, adminAuth, adminContent, adminInsights, customCourses, seo, health
  lib/        auth, totp, cookies, limiters, audit, cache, email, validation, gemini, chatKnowledge, ...
  jobs/       schema bootstrap, content-filter sweeps, daily digest
  test/       API tests (see below); *.test.js files next to the code are unit tests
frontend/   React + TypeScript app (Vite)
QA_REPORT.md  Manual QA notes and hardening history
```

## Local setup

Prerequisites: Node.js 22+ and a MySQL 8 database.

### Backend

```bash
cd backend
npm install
cp .env.example .env    # fill in DB and JWT values
npm start               # http://localhost:5000
```

Required environment variables are documented in `backend/.env.example`:
`JWT_SECRET` (at least 32 characters, or the server refuses to start), the
`DB_*` group, `FRONTEND_URL`, and `EMAIL_USER`/`EMAIL_PASS` for password resets
and security alerts.

### Frontend

```bash
cd frontend
npm install
npm start               # http://localhost:3000
```

The dev server proxies `/api` to the backend; see `frontend/src/services/api.ts`
and `VITE_API_BASE` if you host the API elsewhere.

## Tests

```bash
cd backend && npm test                 # unit tests (+ API tests if TEST_DB_HOST is set)
cd frontend && npm test                # Vitest
cd frontend && npx tsc --noEmit        # type check
```

### API tests

`backend/test/` holds black-box API tests: they start the real `server.js`
against a **disposable** MySQL database, load `schema.sql`, and exercise the
public and admin endpoints over HTTP (reviews, search, moderation, CSRF,
login, 2FA, CORS, rate limits). They **drop every table** in that database,
so never point them at real data.

```bash
# e.g. with Docker
docker run -d --name trs-test-db -p 3306:3306 \
  -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=trs_test mysql:8.0

cd backend
TEST_DB_HOST=127.0.0.1 TEST_DB_USER=root TEST_DB_PASSWORD=test TEST_DB_NAME=trs_test npm test
```

Without `TEST_DB_HOST` the API tests are skipped. CI runs them on every push
against a MySQL 8 service container.

## Administration

The admin panel lives at `/admin`. The first admin account is created through
`POST /api/admin/setup` with the `ADMIN_SETUP_KEY` header (the route returns 404
when the key is unset). Password resets require the email settings from
`.env.example`.

Admin sessions slide on activity and expire after `ADMIN_SESSION_MINUTES` of
inactivity (default 30). Reader reports raised on published reviews are handled
in the **Reports** tab of the admin panel.

## Deployment

- Frontend: Vercel (`frontend/vercel.json` holds rewrites and security headers;
  `/api`, `/sitemap.xml` and `/robots.txt` proxy to the Render backend).
- Backend: Render; set the same environment variables from
  `backend/.env.example`, including `CORS_ALLOWED_ORIGINS` and the production
  `FRONTEND_URL`.

Do not commit `.env` files. Never commit a scraped faculty directory or seeded
admin credentials.

## Review assistant (chat widget)

A floating **Ask AI** button answers questions such as "how is Sir X?" or
"grading kesi krte hn?" in English or Roman Urdu, using only approved reviews,
and explains how to use the site. It is powered by Google Gemini (free tier).

- Set `GEMINI_API_KEY` on the backend (Render) to turn it on. Without it,
  `GET /api/chat/status` returns `{ "enabled": false }` and the button is
  hidden. The key never reaches the browser.
- `POST /api/chat` takes `{ message, history?, teacherId? }`. The server
  finds the teachers the question is about (fuzzy name matching, course
  names and acronyms like PF or OOP), sends their reviews to Gemini with a
  strict "answer only from these reviews" prompt, and returns
  `{ reply, teachers }`. The `teachers` are shown as links under the answer.
- On a teacher's page the widget asks about that teacher by default.
- If several teachers match ("sir ali"), the assistant asks which one,
  or answers for the one with the most reviews and names the others.
- Free-tier protection: per-IP limits (`CHAT_PER_MINUTE`, `CHAT_PER_DAY`),
  a 10-minute answer cache for repeated first questions, and automatic
  fallback across `GEMINI_MODELS` when one model's quota runs out.
- Message text is never logged; logs record only the model, timing and
  which teachers were matched.

See `backend/.env.example` for all settings.

## Health and readiness

Two endpoints, on purpose:

| Endpoint | Checks | Use for |
| --- | --- | --- |
| `GET /api/health` | Process is running | Platform liveness probe |
| `GET /api/ready` | `SELECT 1` against MySQL (2.5 s timeout, 503 on failure) | Uptime monitor, keep-warm ping |

Point an uptime monitor (UptimeRobot, BetterStack, Render health checks) at
`/api/ready`. The Render free tier sleeps after inactivity, so the first request
after a quiet period can take 30–60 seconds — use a 5-minute or slower interval
if the monitor treats timeouts as downtime.

## Backups

The database is the only stateful component; reviews, questions and audit logs
all live in MySQL. Take a logical dump on a schedule and keep it off-provider.

```bash
# Dump (compressed). Prefer a read replica or off-peak window.
mysqldump --single-transaction --quick --routines --triggers \
  --set-gtid-purged=OFF -h "$DB_HOST" -P "${DB_PORT:-3306}" \
  -u "$DB_USER" -p "$DB_NAME" | gzip > "backup-$(date +%F).sql.gz"

# Restore into an empty database
gunzip -c backup-2026-10-25.sql.gz | mysql -h "$DB_HOST" -P "${DB_PORT:-3306}" \
  -u "$DB_USER" -p "$DB_NAME"
```

For Aiven, the console's **Backups** tab provides automated snapshots; enable it
if the plan includes it, and still keep an independent `mysqldump` copy. After a
restore, `npm start` recreates any missing indexes via the schema bootstrap.

Test the restore path once into a scratch database before relying on it.
