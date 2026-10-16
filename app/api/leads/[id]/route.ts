import { NextResponse } from "next/server";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await ensureSchema();
    const { id } = await context.params;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM follow_up_log WHERE lead_id = $1", [id]);
      const result = await client.query("DELETE FROM leads WHERE id = $1", [id]);
      await client.query("COMMIT");
      if (!result.rowCount) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
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
