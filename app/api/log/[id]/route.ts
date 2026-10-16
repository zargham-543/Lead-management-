import { NextResponse } from "next/server";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureSchema();
    const { id } = await context.params;
    const result = await pool.query("DELETE FROM follow_up_log WHERE id = $1", [id]);
    if (!result.rowCount) return NextResponse.json({ error: "Follow-up entry not found." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
