import { NextRequest, NextResponse } from "next/server";
import { checkSameOrigin, requireUser } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!checkSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    await ensureSchema();
    const { id } = await context.params;
    const result = auth.user.role === "manager"
      ? await pool.query("DELETE FROM follow_up_log WHERE id = $1", [id])
      : await pool.query(
          `DELETE FROM follow_up_log entry USING leads
           WHERE entry.id = $1 AND entry.lead_id = leads.id AND leads.owner_user_id = $2`,
          [id, auth.user.id]
        );
    if (!result.rowCount) return NextResponse.json({ error: "Follow-up entry not found or not accessible." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
