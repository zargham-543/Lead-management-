import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { checkSameOrigin, hashPassword, requireUser, verifyPassword } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function PUT(request: NextRequest) {
  try {
    if (!checkSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    const body = await request.json();
    const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
    const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
    await ensureSchema();
    const result = await pool.query("SELECT password_hash FROM app_users WHERE id = $1", [auth.user.id]);
    if (!result.rows[0] || !(await verifyPassword(currentPassword, result.rows[0].password_hash))) {
      return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
    }
    const hash = await hashPassword(newPassword);
    const token = request.cookies.get("lead_tracker_session")?.value;
    if (!token) return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("UPDATE app_users SET password_hash = $2 WHERE id = $1", [auth.user.id, hash]);
      await client.query("DELETE FROM app_sessions WHERE user_id = $1 AND token_hash <> $2", [auth.user.id, tokenHash]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Password must")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return apiError(error);
  }
}
