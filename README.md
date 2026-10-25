# UMT Teacher Reviews

Anonymous, moderated teacher reviews for the University of Management and
Technology (Lahore), with a Q&A board, reader reports, and an admin panel for
moderation.

## Structure

```
backend/    Express + MySQL API (server.js, contentFilter.js, db.js)
frontend/   React + TypeScript app (Create React App)
QA_REPORT.md  Manual QA notes and hardening history
```

## Local setup

Prerequisites: Node.js 18+ and a MySQL 8 database.

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
and `REACT_APP_API_BASE` if you host the API elsewhere.

## Tests

```bash
cd backend && npm test                 # node --test
cd frontend && npx react-scripts test --watchAll=false
cd frontend && npx tsc --noEmit        # type check
```

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
