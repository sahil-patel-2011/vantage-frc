import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { canDeleteShooterPoint, parseShooterAction, summarizeTable } from "../../../lib/shooter-table";

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
  return Response.json({ error: error instanceof Error ? error.message : "Shooter table request failed" }, { status });
}

type PointRow = { id: string; tableName: string; distanceFt: number; rpm: number | null; hoodAngle: number | null; notes: string; createdBy: string | null };

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
      if (!row) {
        return {
          status: "setup_required" as const,
          message: requestedOrg
            ? "Choose your team to tune your shooter."
            : "Choose your team to tune your shooter, or join the waitlist.",
        };
      }

      const points = await client.query<PointRow>(
        `SELECT id, table_name AS "tableName", distance_ft::float8 AS "distanceFt", rpm::float8 AS "rpm",
                hood_angle::float8 AS "hoodAngle", notes, created_by AS "createdBy"
         FROM shooter_points WHERE org_id = $1 AND season_year = $2 ORDER BY table_name, distance_ft`,
        [row.orgId, seasonYear],
      );

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role, userId: session.user.id },
        seasonYear,
        points: points.rows,
        summary: summarizeTable(points.rows.map((p) => ({ distanceFt: p.distanceFt, rpm: p.rpm, hoodAngle: p.hoodAngle }))),
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
    const action = parseShooterAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      if (action.action === "delete_point") {
        const found = await client.query<{ createdBy: string; role: string }>(
          `SELECT p.created_by AS "createdBy", m.role
           FROM shooter_points p
           JOIN memberships m ON m.org_id = p.org_id AND m.user_id = $3
           WHERE p.id = $1 AND p.org_id = $2`,
          [action.id, action.orgId, userId],
        );
        if (!found.rowCount) throw new HttpError(404, "Point not found");
        if (!canDeleteShooterPoint({ role: found.rows[0]!.role, userId, authorId: found.rows[0]!.createdBy })) {
          throw new HttpError(403, "You cannot delete this point");
        }
        const deleted = await client.query(`DELETE FROM shooter_points WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
        if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this point");
        return { ok: true };
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO shooter_points (org_id, season_year, table_name, distance_ft, rpm, hood_angle, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (org_id, season_year, table_name, distance_ft) DO UPDATE SET
           rpm = excluded.rpm, hood_angle = excluded.hood_angle, notes = excluded.notes, updated_at = now()
         RETURNING id`,
        [action.orgId, action.seasonYear, action.tableName, action.distanceFt, action.rpm, action.hoodAngle, action.notes, userId],
      );
      return { id: inserted.rows[0]!.id };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
