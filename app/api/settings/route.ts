import { NextRequest, NextResponse } from "next/server";
import { checkSameOrigin, requireManager, requireUser } from "@/lib/auth";
import { DEFAULT_SETTINGS } from "@/lib/defaults";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    await ensureSchema();
    const result = await pool.query("SELECT data FROM tracker_settings WHERE id = 'main'");
    return NextResponse.json({ ...DEFAULT_SETTINGS, ...(result.rows[0]?.data ?? {}) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!checkSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    const auth = await requireManager(request);
    if (auth.response) return auth.response;
    await ensureSchema();
    const body = await request.json();
    const settings = body.data;
    if (!settings || !Array.isArray(settings.statuses) || !Array.isArray(settings.platforms)) {
      return NextResponse.json({ error: "Settings data is invalid." }, { status: 400 });
    }
    const result = await pool.query(
      `INSERT INTO tracker_settings (id, data) VALUES ('main', $1)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
       RETURNING data`,
      [JSON.stringify(settings)]
    );
    return NextResponse.json(result.rows[0].data);
  } catch (error) {
    return apiError(error);
  }
}
