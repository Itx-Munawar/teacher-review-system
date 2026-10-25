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

Required environment variables are documented in `backend/.env.example`
(`JWT_SECRET`, `DB_*`, `FRONTEND_URL`). Email variables are only needed for
password resets and security alerts.

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
