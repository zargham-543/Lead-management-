import { NextResponse } from "next/server";
import { ensureSchema, pool } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureSchema();
    await pool.query("SELECT 1");
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Health check failed", error);
    return NextResponse.json({ ok: false, error: "Database is unavailable." }, { status: 503 });
  }
}
