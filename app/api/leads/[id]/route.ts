import { NextResponse } from "next/server";
import { checkSameOrigin, requireUser } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function DELETE(request: import("next/server").NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    if (!checkSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    await ensureSchema();
    const { id } = await context.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const ownerClause = auth.user.role === "manager" ? "" : " AND owner_user_id = $2";
      const values = auth.user.role === "manager" ? [id] : [id, auth.user.id];
      const result = await client.query(`DELETE FROM leads WHERE id = $1${ownerClause}`, values);
      if (!result.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Lead not found or not accessible." }, { status: 404 });
      }
      await client.query("DELETE FROM follow_up_log WHERE lead_id = $1", [id]);
      await client.query("COMMIT");
      return NextResponse.json({ ok: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return apiError(error);
  }
}
