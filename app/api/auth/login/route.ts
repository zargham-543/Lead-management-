import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie, verifyPassword, checkSameOrigin } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!checkSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    await ensureSchema();
    const body = await request.json();
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const result = await pool.query(
      "SELECT id, name, email, role, password_hash FROM app_users WHERE email = $1",
      [email]
    );
    const user = result.rows[0];
    const valid = user ? await verifyPassword(password, user.password_hash) : false;
    if (!valid) return NextResponse.json({ error: "Email or password is incorrect." }, { status: 401 });
    const session = await createSession(user.id);
    const response = NextResponse.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });
    return setSessionCookie(response, session.token, session.expiresAt);
  } catch (error) {
    return apiError(error);
  }
}
