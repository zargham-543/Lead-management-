import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createSession, hashPassword, setSessionCookie, checkSameOrigin } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!checkSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    await ensureSchema();
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (name.length < 2 || name.length > 100) {
      return NextResponse.json({ error: "Name must be between 2 and 100 characters." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    await pool.query(
      "INSERT INTO app_users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, 'member')",
      [userId, name, email, passwordHash]
    );
    const session = await createSession(userId);
    const response = NextResponse.json({ user: { id: userId, name, email, role: "member" } }, { status: 201 });
    return setSessionCookie(response, session.token, session.expiresAt);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      return NextResponse.json({ error: "An account with this email already exists." }, { status: 409 });
    }
    if (error instanceof Error && error.message.startsWith("Password must")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiError(error);
  }
}
