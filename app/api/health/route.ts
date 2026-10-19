import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    await ensureSchema();
    await pool.query("SELECT 1");
    const user = await getSessionUser(request);
    return NextResponse.json({ ok: true, authenticated: Boolean(user), ...(user ? { role: user.role } : {}) });
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json({ ok: false, error: "Database is unavailable." }, { status: 503 });
  }
}
