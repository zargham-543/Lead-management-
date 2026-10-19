import { randomUUID, scryptSync, randomBytes } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { loadEnvConfig } from "@next/env";
import pg from "pg";

if (!process.env.DATABASE_URL) loadEnvConfig(process.cwd());
const { Pool } = pg;
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is required. Set it in .env.local before creating a manager.");
  process.exit(1);
}

const terminal = createInterface({ input: stdin, output: stdout });
const name = (await terminal.question("Manager name: ")).trim();
const email = (await terminal.question("Manager email: ")).trim().toLowerCase();
terminal.close();
const password = await new Promise((resolve, reject) => {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    reject(new Error("Run this command in an interactive terminal so the password can be entered without echo."));
    return;
  }
  stdout.write("Manager password (input hidden): ");
  let value = "";
  const finish = (error) => {
    stdin.setRawMode(false);
    stdin.pause();
    stdin.removeListener("data", onData);
    stdout.write("\n");
    if (error) reject(error);
    else resolve(value);
  };
  const onData = (chunk) => {
    for (const character of chunk.toString()) {
      if (character === "\u0003") {
        finish(new Error("Cancelled."));
        return;
      }
      if (character === "\r" || character === "\n") {
        finish();
        return;
      }
      if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
      else value += character;
    }
  };
  stdin.setRawMode(true);
  stdin.resume();
  stdin.on("data", onData);
});

if (name.length < 2 || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Enter a valid name and email.");
  process.exit(1);
}
if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/.test(password)) {
  console.error("Password must be at least 12 characters and include uppercase, lowercase, and a number.");
  process.exit(1);
}

const salt = randomBytes(16);
const derived = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
const passwordHash = `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
const pool = new Pool({
  connectionString,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined
});

try {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('manager', 'member')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query("BEGIN");
  await pool.query("LOCK TABLE app_users IN EXCLUSIVE MODE");
  const managers = await pool.query("SELECT COUNT(*)::INTEGER AS count FROM app_users WHERE role = 'manager'");
  if (managers.rows[0].count > 0) {
    await pool.query("ROLLBACK");
    console.error("A manager already exists. Sign up as a member and ask a manager to promote your account.");
    process.exitCode = 1;
  } else {
    const id = randomUUID();
    await pool.query(
      "INSERT INTO app_users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'manager')",
      [id, name, email, passwordHash]
    );
    await pool.query("COMMIT");
    console.log(`Manager account created for ${email}. Sign in at /login.`);
  }
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  console.error(error instanceof Error ? error.message : "Unable to create manager account.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
