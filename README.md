# Lead Follow-up Tracker

Next.js App Router application with PostgreSQL storage, authentication, and
manager/member roles. Managers can see every team's leads, filter by teammate,
view team-wide dashboard KPIs and per-member lead, follow-up, and touchpoint
stats, and manage account roles. Members can see and edit leads they own.

## Run locally

1. Install Node.js 20 or newer and PostgreSQL.
2. Create an empty database, for example `lead_tracker`.
3. Copy `.env.example` to `.env.local` and set `DATABASE_URL` to your
   PostgreSQL connection URL. Keep the real URL in `.env.local` only.
4. Install dependencies and start the app:

   ```powershell
   npm install
   npm run dev
   ```

5. In a second terminal, bootstrap the first manager:

   ```powershell
   npm run create-manager
   ```

   Enter the manager name, email, and password when prompted. Password entry is
   hidden. Then sign in at <http://localhost:3000/login>.

Teammates can register from the sign-in page. New accounts start as members;
managers can promote them from the **Team** tab. Users can change their
password under Settings.

Passwords must be at least 12 characters and include uppercase, lowercase,
and a number. Self-registration is open and email addresses are not verified,
so distribute the app URL only to your team. Add email verification, rate
limiting, or invite-only registration before exposing it publicly.

## Database and API

The PostgreSQL schema is initialized/upgraded by `lib/db.ts`. Leads and
follow-up history are scoped to their creator; managers can read across the
whole team. Shared tracker settings are manager-editable.

- `GET/POST/PUT /api/leads`, `DELETE /api/leads/:id`
- `GET/POST /api/log`, `DELETE /api/log/:id`
- `GET/PUT /api/settings`
- `GET/PUT /api/team` (manager only)
- `/api/auth/*` account registration, sign-in, sign-out, and password change
- `GET /api/health`

Set `DATABASE_URL` to a managed PostgreSQL connection string when deploying.
Keep it server-side; do not prefix it with `NEXT_PUBLIC_`.

## Data migration

The standalone HTML tracker stores data only when its host supplies the Claude
database bridge; this app cannot read that storage directly. Export existing
leads to CSV from that environment, then use **Import CSV** in the Next.js app.
Supported fields include title, company, contact, platform, profile, status,
priority, link, terms, dateAdded, override, summary, remarks, and taskLink.

Existing unassigned leads remain visible to managers. They are not automatically
assigned to a teammate; members see leads they create after signing in.
