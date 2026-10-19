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
      ? await pool.query("SELECT id, data, created_by, updated_by, owner_user_id FROM leads ORDER BY id")
      : await pool.query(
          "SELECT id, data, created_by, updated_by, owner_user_id FROM leads WHERE owner_user_id = $1 ORDER BY id",
          [auth.user.id]
        );
    return NextResponse.json(
      result.rows.map((row) => ({
        ...row.data,
        id: row.id,
        createdBy: row.created_by,
        updatedBy: row.updated_by,
        ownerId: row.owner_user_id
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
    if (!data || typeof data !== "object" || (!data.title && !data.company)) {
      return NextResponse.json({ error: "A title or company is required." }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("LOCK TABLE leads IN EXCLUSIVE MODE");
      const max = await client.query<{ next_id: number }>(`
        SELECT COALESCE(MAX(NULLIF(regexp_replace(id, '\\D', '', 'g'), '')::INTEGER), 0) + 1 AS next_id
        FROM leads
        WHERE id ~ '^LD-[0-9]+$'
      `);
      const id = `LD-${String(max.rows[0].next_id).padStart(3, "0")}`;
      const saved = await client.query(
        `INSERT INTO leads (id, data, created_by, updated_by, owner_user_id, updated_by_user_id)
         VALUES ($1, $2, $3, $3, $4, $4)
         RETURNING id, data, created_by, updated_by, owner_user_id`,
        [id, JSON.stringify(data), auth.user.name, auth.user.id]
      );
      await client.query("COMMIT");
      const row = saved.rows[0];
      return NextResponse.json(
        { ...row.data, id: row.id, createdBy: row.created_by, updatedBy: row.updated_by, ownerId: row.owner_user_id },
        { status: 201 }
      );
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (!checkSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
    const auth = await requireUser(request);
    if (auth.response) return auth.response;
    await ensureSchema();
    const body = await request.json();
    const id = typeof body.id === "string" ? body.id : "";
    const data = body.data as Record<string, unknown>;
    if (!id || !data || typeof data !== "object" || (!data.title && !data.company)) {
      return NextResponse.json({ error: "A lead ID and title or company are required." }, { status: 400 });
    }
    const ownerClause = auth.user.role === "manager" ? "" : " AND owner_user_id = $4";
    const values = auth.user.role === "manager"
      ? [id, JSON.stringify(data), auth.user.name]
      : [id, JSON.stringify(data), auth.user.name, auth.user.id];
    const result = await pool.query(
      `UPDATE leads SET data = $2, updated_by = $3, updated_by_user_id = $4, updated_at = NOW()
       WHERE id = $1${ownerClause} RETURNING id, data, created_by, updated_by, owner_user_id`,
      auth.user.role === "manager"
        ? [id, JSON.stringify(data), auth.user.name, auth.user.id]
        : values
    );
    if (!result.rowCount) return NextResponse.json({ error: "Lead not found or not accessible." }, { status: 404 });
    const row = result.rows[0];
    return NextResponse.json({
      ...row.data,
      id: row.id,
      createdBy: row.created_by,
      updatedBy: row.updated_by,
      ownerId: row.owner_user_id
    });
  } catch (error) {
    return apiError(error);
  }
}
