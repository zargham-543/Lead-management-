import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, pool } from "@/lib/db";

export const SESSION_COOKIE = "lead_tracker_session";
const SESSION_DAYS = 14;
const PASSWORD_PATTERN = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,}$/;

export type SessionUser = {
  id: string;
  name: string;
  email: string;
  role: "manager" | "member";
};

export async function hashPassword(password: string) {
  if (password.length > 128 || !PASSWORD_PATTERN.test(password)) {
    throw new Error("Password must be at least 12 characters and include uppercase, lowercase, and a number.");
  }
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, 64);
  return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string) {
  if (password.length > 128) return false;
  const [scheme, n, r, p, saltHex, keyHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await deriveKey(password, Buffer.from(saltHex, "hex"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p)
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function deriveKey(password: string, salt: Buffer, length: number, options = { N: 16384, r: 8, p: 1 }) {
  return new Promise<Buffer>((resolve, reject) => {
    scryptCallback(password, salt, length, options, (error, derived) => {
      if (error) reject(error);
      else resolve(derived as Buffer);
    });
  });
}

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string) {
  await ensureSchema();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await pool.query(
    "INSERT INTO app_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)",
    [tokenHash(token), userId, expiresAt]
  );
  await pool.query("DELETE FROM app_sessions WHERE expires_at <= NOW()");
  return { token, expiresAt };
}

export async function getSessionUser(request: NextRequest): Promise<SessionUser | null> {
  await ensureSchema();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await pool.query(
    `SELECT users.id, users.name, users.email, users.role
     FROM app_sessions sessions
     JOIN app_users users ON users.id = sessions.user_id
     WHERE sessions.token_hash = $1 AND sessions.expires_at > NOW()`,
    [tokenHash(token)]
  );
  return (result.rows[0] as SessionUser | undefined) ?? null;
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: expiresAt
  });
  return response;
}

export async function requireUser(request: NextRequest) {
  const user = await getSessionUser(request);
  if (!user) {
    return {
      user: null,
      response: NextResponse.json({ error: "Sign in to continue." }, { status: 401 })
    } as const;
  }
  return { user, response: null } as const;
}

export async function requireManager(request: NextRequest) {
  const auth = await requireUser(request);
  if (auth.response) return auth;
  if (auth.user.role !== "manager") {
    return {
      user: null,
      response: NextResponse.json({ error: "Manager access is required." }, { status: 403 })
    } as const;
  }
  return auth;
}

export function checkSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.get("host");
  } catch {
    return false;
  }
}
