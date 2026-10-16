import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, pool } from "@/lib/db";
import { apiError, requiredText } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureSchema();
    const result = await pool.query(
      `SELECT id, lead_id, data, created_by, updated_by
       FROM follow_up_log ORDER BY data->>'date' DESC, created_at DESC`
    );
    return NextResponse.json(
      result.rows.map((row) => ({
        ...row.data,
        id: row.id,
        leadId: row.lead_id,
        createdBy: row.created_by,
        updatedBy: row.updated_by
      }))
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureSchema();
    const body = await request.json();
    const actor = requiredText(body.actor, "Your name");
    const data = body.data as Record<string, unknown>;
    const id = requiredText(data?.id, "Log ID");
    const leadId = requiredText(data?.leadId, "Lead");
    if (typeof data.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      return NextResponse.json({ error: "A valid date is required." }, { status: 400 });
    }
    const lead = await pool.query("SELECT 1 FROM leads WHERE id = $1", [leadId]);
    if (!lead.rowCount) return NextResponse.json({ error: "Selected lead does not exist." }, { status: 400 });
    const result = await pool.query(
      `INSERT INTO follow_up_log (id, lead_id, data, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $4)
       RETURNING id, lead_id, data, created_by, updated_by`,
      [id, leadId, JSON.stringify(data), actor]
    );
    const row = result.rows[0];
    return NextResponse.json(
      {
        ...row.data,
        id: row.id,
        leadId: row.lead_id,
        createdBy: row.created_by,
        updatedBy: row.updated_by
      },
      { status: 201 }
    );
  } catch (error) {
    return apiError(error);
  }
}
