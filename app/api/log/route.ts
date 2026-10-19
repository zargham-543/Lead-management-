import { NextRequest, NextResponse } from "next/server";
import { checkSameOrigin, requireUser } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    await ensureSchema();
    const result = auth.user.role === "manager"
      ? await pool.query(
          `SELECT entry.id, entry.lead_id, entry.data, entry.created_by, entry.updated_by
           FROM follow_up_log entry ORDER BY entry.data->>'date' DESC, entry.created_at DESC`
        )
      : await pool.query(
          `SELECT entry.id, entry.lead_id, entry.data, entry.created_by, entry.updated_by
           FROM follow_up_log entry
           JOIN leads ON leads.id = entry.lead_id
           WHERE leads.owner_user_id = $1
           ORDER BY entry.data->>'date' DESC, entry.created_at DESC`,
          [auth.user.id]
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
    if (!checkSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    await ensureSchema();
    const body = await request.json();
    const data = body.data as Record<string, unknown>;
    const id = typeof data?.id === "string" ? data.id.trim() : "";
    const leadId = typeof data?.leadId === "string" ? data.leadId.trim() : "";
    if (!id || !leadId || typeof data.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data.date)) {
      return NextResponse.json({ error: "A lead and valid date are required." }, { status: 400 });
    }
    const values = auth.user.role === "manager" ? [leadId] : [leadId, auth.user.id];
    const ownerClause = auth.user.role === "manager" ? "" : " AND owner_user_id = $2";
    const lead = await pool.query(`SELECT 1 FROM leads WHERE id = $1${ownerClause}`, values);
    if (!lead.rowCount) return NextResponse.json({ error: "Selected lead does not exist or is not accessible." }, { status: 400 });
    const result = await pool.query(
      `INSERT INTO follow_up_log (id, lead_id, data, created_by, updated_by, owner_user_id, updated_by_user_id)
       VALUES ($1, $2, $3, $4, $4, $5, $5)
       RETURNING id, lead_id, data, created_by, updated_by`,
      [id, leadId, JSON.stringify(data), auth.user.name, auth.user.id]
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
