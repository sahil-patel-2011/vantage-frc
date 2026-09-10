import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseControlMapAction, summarizeBindings, type ControlMode, type Controller } from "../../../lib/control-map";

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function requireSession() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new HttpError(401, "Authentication required");
  return session;
}

async function requireMembership(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [orgId, userId]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Control map request failed" }, { status });
}

type BindingRow = { id: string; controller: Controller; inputLabel: string; command: string; mode: ControlMode; notes: string; byName: string | null };

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const seasonYear = Number(url.searchParams.get("seasonYear") ?? new Date().getFullYear());

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{ orgId: string; orgName: string; role: string }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", m.role
         FROM memberships m JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );
      const row = membership.rows[0];
      if (!row) return { status: "setup_required" as const, message: "Select a team to map your controls." };

      const bindings = await client.query<BindingRow>(
        `SELECT b.id, b.controller, b.input_label AS "inputLabel", b.command, b.mode, b.notes, u.name AS "byName"
         FROM control_bindings b LEFT JOIN users u ON u.id = b.created_by
         WHERE b.org_id = $1 AND b.season_year = $2
         ORDER BY CASE b.controller WHEN 'driver' THEN 0 WHEN 'operator' THEN 1 ELSE 2 END, b.input_label`,
        [row.orgId, seasonYear],
      );

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        bindings: bindings.rows,
        summary: summarizeBindings(bindings.rows.map((b) => ({ controller: b.controller }))),
      };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseControlMapAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      if (action.action === "delete_binding") {
        const deleted = await client.query(`DELETE FROM control_bindings WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
        if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this binding");
        return { ok: true };
      }

      const d = action.action === "create_binding" ? action : action.patch;
      if (action.action === "create_binding") {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO control_bindings (org_id, season_year, controller, input_label, command, mode, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [action.orgId, action.seasonYear, d.controller, d.inputLabel, d.command, d.mode, d.notes, userId],
        );
        return { id: inserted.rows[0]!.id };
      }

      const updated = await client.query(
        `UPDATE control_bindings SET controller = $1, input_label = $2, command = $3, mode = $4, notes = $5, updated_at = now()
         WHERE id = $6 AND org_id = $7`,
        [d.controller, d.inputLabel, d.command, d.mode, d.notes, action.id, action.orgId],
      );
      if (!updated.rowCount) throw new HttpError(404, "Binding not found");
      return { ok: true };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
