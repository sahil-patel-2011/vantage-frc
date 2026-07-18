import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { computeFreeSpeedFps, motorFreeRpm, parseSubsystemAction, type SubsystemCategory } from "../../../lib/subsystems";

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
  return Response.json({ error: error instanceof Error ? error.message : "Subsystem request failed" }, { status });
}

type SubsystemRow = {
  id: string; name: string; category: SubsystemCategory; motorType: string; motorCount: number | null;
  gearReduction: number | null; wheelDiameterIn: number | null; notes: string; byName: string | null;
};

const SELECT_COLS = `id, name, category, motor_type AS "motorType", motor_count AS "motorCount",
  gear_reduction::float8 AS "gearReduction", wheel_diameter_in::float8 AS "wheelDiameterIn", notes`;

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
      if (!row) return { status: "setup_required" as const, message: "Select a team workspace to spec your subsystems." };

      const subsystems = await client.query<SubsystemRow>(
        `SELECT ${SELECT_COLS}, u.name AS "byName"
         FROM robot_subsystems s LEFT JOIN users u ON u.id = s.created_by
         WHERE s.org_id = $1 AND s.season_year = $2 ORDER BY s.category, s.name`,
        [row.orgId, seasonYear],
      );

      const enriched = subsystems.rows.map((s) => ({
        ...s,
        freeSpeedFps: computeFreeSpeedFps(motorFreeRpm(s.motorType), s.gearReduction, s.wheelDiameterIn),
      }));

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        subsystems: enriched,
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
    const action = parseSubsystemAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      if (action.action === "delete_subsystem") {
        const deleted = await client.query(`DELETE FROM robot_subsystems WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
        if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this subsystem");
        return { ok: true };
      }

      const d = action.action === "create_subsystem" ? action : action.patch;
      if (action.action === "create_subsystem") {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO robot_subsystems (org_id, season_year, name, category, motor_type, motor_count, gear_reduction, wheel_diameter_in, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [action.orgId, action.seasonYear, d.name, d.category, d.motorType, d.motorCount, d.gearReduction, d.wheelDiameterIn, d.notes, userId],
        );
        return { id: inserted.rows[0]!.id };
      }

      const updated = await client.query(
        `UPDATE robot_subsystems SET name = $1, category = $2, motor_type = $3, motor_count = $4, gear_reduction = $5,
           wheel_diameter_in = $6, notes = $7, updated_at = now()
         WHERE id = $8 AND org_id = $9`,
        [d.name, d.category, d.motorType, d.motorCount, d.gearReduction, d.wheelDiameterIn, d.notes, action.id, action.orgId],
      );
      if (!updated.rowCount) throw new HttpError(404, "Subsystem not found");
      return { ok: true };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
