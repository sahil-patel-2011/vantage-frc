import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseAutoRoutineAction, summarizeRoutines, type AutoPriority, type AutoStatus, type StartPosition } from "../../../lib/auto-routines";

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
  return Response.json({ error: error instanceof Error ? error.message : "Auto routine request failed" }, { status });
}

type RoutineRow = {
  id: string; name: string; startPosition: StartPosition; status: AutoStatus; priority: AutoPriority;
  estimatedPoints: number | null; description: string; pathNotes: string; byName: string | null;
};

// Qualified with the `auto_routines r` alias: the only reader joins `users u`,
// which also has id/name, so unqualified columns raised
// `column reference "id" is ambiguous` and the whole route 400'd.
const SELECT_COLS = `r.id, r.name, r.start_position AS "startPosition", r.status, r.priority,
  r.estimated_points AS "estimatedPoints", r.description, r.path_notes AS "pathNotes"`;

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
      if (!row) return { status: "setup_required" as const, message: "Choose your team to catalog your autos." };

      const routines = await client.query<RoutineRow>(
        `SELECT ${SELECT_COLS}, u.name AS "byName"
         FROM auto_routines r LEFT JOIN users u ON u.id = r.created_by
         WHERE r.org_id = $1 AND r.season_year = $2
         ORDER BY CASE r.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, r.name`,
        [row.orgId, seasonYear],
      );

      const summary = summarizeRoutines(routines.rows.map((r) => ({ status: r.status, priority: r.priority, startPosition: r.startPosition, estimatedPoints: r.estimatedPoints })));
      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        routines: routines.rows,
        summary,
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
    const action = parseAutoRoutineAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "create_routine": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO auto_routines (org_id, season_year, name, start_position, status, priority, estimated_points, description, path_notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
            [action.orgId, action.seasonYear, action.name, action.startPosition, action.status, action.priority, action.estimatedPoints, action.description, action.pathNotes, userId],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "update_routine": {
          const d = action.patch;
          const updated = await client.query(
            `UPDATE auto_routines SET name = $1, start_position = $2, status = $3, priority = $4, estimated_points = $5,
               description = $6, path_notes = $7, updated_at = now()
             WHERE id = $8 AND org_id = $9`,
            [d.name, d.startPosition, d.status, d.priority, d.estimatedPoints, d.description, d.pathNotes, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Routine not found");
          return { ok: true };
        }
        case "set_status": {
          const updated = await client.query(`UPDATE auto_routines SET status = $1, updated_at = now() WHERE id = $2 AND org_id = $3`, [action.status, action.id, action.orgId]);
          if (!updated.rowCount) throw new HttpError(404, "Routine not found");
          return { ok: true };
        }
        case "delete_routine": {
          const deleted = await client.query(`DELETE FROM auto_routines WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this routine");
          return { ok: true };
        }
        default:
          throw new HttpError(400, "Unsupported auto routine action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
