# Lead Follow-up Tracker

The tracker is a Next.js App Router application with a PostgreSQL backend. It
retains the dashboard, searchable/filterable leads, follow-up history, status
cadences, task CSV export/import, and created/edited-by attribution.

## Run locally

1. Install Node.js 20 or newer and PostgreSQL.
2. Create an empty database, for example `lead_tracker`.
3. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your
   PostgreSQL connection URL.
4. Install dependencies and start the development server:

   ```powershell
   npm install
   npm run dev
   ```

5. Open <http://localhost:3000>. The API creates the required tables on its
   first request.

For example, a local PostgreSQL URL is
`postgresql://postgres:your-password@localhost:5432/lead_tracker`.

## Database and API

The PostgreSQL schema is initialized by `lib/db.ts`. The JSON payload columns
keep lead fields flexible while IDs, ownership attribution, and timestamps are
stored separately. The application API is available at:

- `GET/POST/PUT /api/leads`, `DELETE /api/leads/:id`
- `GET/POST /api/log`, `DELETE /api/log/:id`
- `GET/PUT /api/settings`
- `GET /api/health`

Set `DATABASE_URL` to a managed PostgreSQL connection string when deploying.
Keep the URL server-side; do not prefix it with `NEXT_PUBLIC_`.

The “Your name” value is saved in this browser and sent with writes for
attribution. It is self-reported, not authentication; add an authentication
provider before exposing write access to untrusted users or the public internet.

## Data migration

The existing standalone HTML page stores data only when its host supplies the
Claude database bridge; it does not provide a local database that this app can
read. Export existing leads to CSV from that environment, then use **Import
CSV** in the new app. CSV import accepts a header row and supports title,
company, contact, platform, profile, status, priority, link, terms, dateAdded,
override, summary, remarks, and taskLink.
