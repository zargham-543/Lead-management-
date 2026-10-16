import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, pool } from "@/lib/db";
import { apiError, requiredText } from "@/lib/http";

export const runtime = "nodejs";

export async function GET() {
  try {
    await ensureSchema();
    const result = await pool.query(
      "SELECT id, data, created_by, updated_by FROM leads ORDER BY id"
    );
    return NextResponse.json(
      result.rows.map((row) => ({
        ...row.data,
        id: row.id,
        createdBy: row.created_by,
        updatedBy: row.updated_by
      }))
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  const client = await pool.connect();
  try {
    await ensureSchema();
    const body = await request.json();
    const actor = requiredText(body.actor, "Your name");
    const data = body.data as Record<string, unknown>;
    if (!data || typeof data !== "object" || (!data.title && !data.company)) {
      return NextResponse.json({ error: "A title or company is required." }, { status: 400 });
    }

    await client.query("BEGIN");
    await client.query("LOCK TABLE leads IN EXCLUSIVE MODE");
    const max = await client.query<{ next_id: number }>(`
      SELECT COALESCE(MAX(NULLIF(regexp_replace(id, '\\D', '', 'g'), '')::INTEGER), 0) + 1 AS next_id
      FROM leads
      WHERE id ~ '^LD-[0-9]+$'
    `);
    const id = `LD-${String(max.rows[0].next_id).padStart(3, "0")}`;
    const saved = await client.query(
      `INSERT INTO leads (id, data, created_by, updated_by)
       VALUES ($1, $2, $3, $3)
       RETURNING id, data, created_by, updated_by`,
      [id, JSON.stringify(data), actor]
    );
    await client.query("COMMIT");
    const row = saved.rows[0];
    return NextResponse.json(
      { ...row.data, id: row.id, createdBy: row.created_by, updatedBy: row.updated_by },
      { status: 201 }
    );
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return apiError(error);
  } finally {
    client.release();
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureSchema();
    const body = await request.json();
    const id = requiredText(body.id, "Lead ID");
    const actor = requiredText(body.actor, "Your name");
    const data = body.data as Record<string, unknown>;
    if (!data || typeof data !== "object" || (!data.title && !data.company)) {
      return NextResponse.json({ error: "A title or company is required." }, { status: 400 });
    }
    const result = await pool.query(
      `UPDATE leads SET data = $2, updated_by = $3, updated_at = NOW()
       WHERE id = $1 RETURNING id, data, created_by, updated_by`,
      [id, JSON.stringify(data), actor]
    );
    if (!result.rowCount) return NextResponse.json({ error: "Lead not found." }, { status: 404 });
    const row = result.rows[0];
    return NextResponse.json({
      ...row.data,
      id: row.id,
      createdBy: row.created_by,
      updatedBy: row.updated_by
    });
  } catch (error) {
    return apiError(error);
  }
}
