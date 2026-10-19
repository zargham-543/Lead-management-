import { NextRequest, NextResponse } from "next/server";
import { checkSameOrigin, requireManager } from "@/lib/auth";
import { ensureSchema, pool } from "@/lib/db";
import { apiError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const auth = await requireManager(request);
    if (auth.response) return auth.response;
    await ensureSchema();
    const result = await pool.query(
      `SELECT users.id, users.name, users.email, users.role, users.created_at,
        (SELECT COUNT(*) FROM leads WHERE owner_user_id = users.id)::INTEGER AS lead_count
       FROM app_users users ORDER BY users.created_at`
    );
    return NextResponse.json(result.rows);
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
    const userId = typeof body.userId === "string" ? body.userId : "";
    const role = body.role === "manager" || body.role === "member" ? body.role : null;
    if (!userId || !role) return NextResponse.json({ error: "Select a valid account role." }, { status: 400 });
    if (userId === auth.user.id && role !== "manager") {
      return NextResponse.json({ error: "You cannot remove your own manager access." }, { status: 400 });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("LOCK TABLE app_users IN EXCLUSIVE MODE");
      const selected = await client.query("SELECT id, role FROM app_users WHERE id = $1 FOR UPDATE", [userId]);
      if (!selected.rowCount) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "Account not found." }, { status: 404 });
      }
      if (selected.rows[0].role === "manager" && role !== "manager") {
        const managers = await client.query("SELECT COUNT(*)::INTEGER AS count FROM app_users WHERE role = 'manager'");
        if (managers.rows[0].count <= 1) {
          await client.query("ROLLBACK");
          return NextResponse.json({ error: "The last manager cannot be changed to a member." }, { status: 400 });
        }
      }
      const result = await client.query(
        `UPDATE app_users SET role = $2 WHERE id = $1
         RETURNING id, name, email, role, created_at`,
        [userId, role]
      );
      await client.query("COMMIT");
      return NextResponse.json(result.rows[0]);
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
