import { Pool } from "pg";

declare global {
  // eslint-disable-next-line no-var
  var leadTrackerPool: Pool | undefined;
  // eslint-disable-next-line no-var
  var leadTrackerSchemaReady: Promise<void> | undefined;
}

const connectionString = process.env.DATABASE_URL;

export const pool =
  globalThis.leadTrackerPool ??
  new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
  });

if (process.env.NODE_ENV !== "production") globalThis.leadTrackerPool = pool;

export async function ensureSchema() {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required. Copy .env.example to .env.local and configure PostgreSQL.");
  }
  if (!globalThis.leadTrackerSchemaReady) {
    globalThis.leadTrackerSchemaReady = pool
      .query(`
        CREATE TABLE IF NOT EXISTS leads (
          id TEXT PRIMARY KEY,
          data JSONB NOT NULL,
          created_by TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS follow_up_log (
          id TEXT PRIMARY KEY,
          lead_id TEXT NOT NULL,
          data JSONB NOT NULL,
          created_by TEXT NOT NULL,
          updated_by TEXT NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS follow_up_log_lead_date_idx
          ON follow_up_log (lead_id, (data->>'date') DESC);
        CREATE TABLE IF NOT EXISTS tracker_settings (
          id TEXT PRIMARY KEY DEFAULT 'main',
          data JSONB NOT NULL,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS app_users (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'member')),
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS app_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
          expires_at TIMESTAMPTZ NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE INDEX IF NOT EXISTS app_sessions_expiry_idx ON app_sessions (expires_at);
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS owner_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL;
        ALTER TABLE follow_up_log ADD COLUMN IF NOT EXISTS owner_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL;
        ALTER TABLE follow_up_log ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL;
        ALTER TABLE leads ADD COLUMN IF NOT EXISTS updated_by_user_id TEXT REFERENCES app_users(id) ON DELETE SET NULL;
        CREATE INDEX IF NOT EXISTS leads_owner_idx ON leads (owner_user_id);
        CREATE INDEX IF NOT EXISTS follow_up_log_owner_idx ON follow_up_log (owner_user_id);
      `)
      .then(() => undefined)
      .catch((error) => {
        globalThis.leadTrackerSchemaReady = undefined;
        throw error;
      });
  }
  await globalThis.leadTrackerSchemaReady;
}
