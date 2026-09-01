import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { upsertGearbox } from "../../../lib/gearbox/service";
import { parseGearboxWrite } from "../../../lib/gearbox/upsert";
import { compoundReduction, outputRpm, type Stage } from "../../../lib/gearbox";

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
  return Response.json({ error: error instanceof Error ? error.message : "Gearbox request failed" }, { status });
}

type GearboxRow = { id: string; name: string; subsystem: string; stages: Stage[]; motorFreeRpm: number | null; notes: string; byName: string | null };

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
      if (!row) return { status: "setup_required" as const, message: "Select a team workspace to design gearboxes." };

      const gearboxes = await client.query<GearboxRow>(
        `SELECT g.id, g.name, g.subsystem, g.stages, g.motor_free_rpm::float8 AS "motorFreeRpm", g.notes, u.name AS "byName"
         FROM gearboxes g LEFT JOIN users u ON u.id = g.created_by
         WHERE g.org_id = $1 AND g.season_year = $2 ORDER BY g.subsystem, g.name`,
        [row.orgId, seasonYear],
      );

      const enriched = gearboxes.rows.map((g) => {
        const reduction = compoundReduction(g.stages);
        return { ...g, reduction, outputRpm: g.motorFreeRpm != null ? outputRpm(g.motorFreeRpm, reduction) : null };
      });

      return { status: "ready" as const, context: { orgId: row.orgId, orgName: row.orgName, role: row.role }, seasonYear, gearboxes: enriched };
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseGearboxWrite(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      if (action.action === "delete_gearbox") {
        const deleted = await client.query(`DELETE FROM gearboxes WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
        if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this gearbox");
        return { ok: true };
      }

      return upsertGearbox(client, {
        orgId: action.orgId,
        seasonYear: action.seasonYear,
        name: action.name,
        subsystem: action.subsystem,
        stages: action.stages,
        motorFreeRpm: action.motorFreeRpm,
        notes: action.notes,
        createdBy: userId,
        id: action.id,
      });
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
