import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, checkSameOrigin } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    if (!checkSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    await ensureSchema();
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (token) {
      const hash = createHash("sha256").update(token).digest("hex");
      await pool.query("DELETE FROM app_sessions WHERE token_hash = $1", [hash]);
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: 0
    });
    return response;
  } catch (error) {
    return apiError(error);
  }
}
