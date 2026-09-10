import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parsePowerAction, summarizePower } from "../../../lib/power-budget";

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
  return Response.json({ error: error instanceof Error ? error.message : "Power budget request failed" }, { status });
}

type LoadRow = {
  id: string; name: string; subsystem: string; motorCount: number | null;
  typicalAmps: number | null; peakAmps: number | null; breakerAmps: number | null; notes: string; byName: string | null;
};

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
      if (!row) return { status: "setup_required" as const, message: "Select a team to budget power." };

      const loads = await client.query<LoadRow>(
        `SELECT l.id, l.name, l.subsystem, l.motor_count AS "motorCount", l.typical_amps::float8 AS "typicalAmps",
                l.peak_amps::float8 AS "peakAmps", l.breaker_amps::float8 AS "breakerAmps", l.notes, u.name AS "byName"
         FROM power_loads l LEFT JOIN users u ON u.id = l.created_by
         WHERE l.org_id = $1 AND l.season_year = $2 ORDER BY l.subsystem, l.name`,
        [row.orgId, seasonYear],
      );

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        loads: loads.rows,
        summary: summarizePower(
          loads.rows.map((l) => ({
            name: l.name,
            subsystem: l.subsystem,
            typicalAmps: l.typicalAmps,
            peakAmps: l.peakAmps,
            breakerAmps: l.breakerAmps,
            motorCount: l.motorCount,
            notes: l.notes,
          })),
        ),
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
    const action = parsePowerAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      if (action.action === "delete_load") {
        const deleted = await client.query(`DELETE FROM power_loads WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
        if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this load");
        return { ok: true };
      }

      const d = action.action === "create_load" ? action : action.patch;
      if (action.action === "create_load") {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO power_loads (org_id, season_year, name, subsystem, motor_count, typical_amps, peak_amps, breaker_amps, notes, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
          [action.orgId, action.seasonYear, d.name, d.subsystem, d.motorCount, d.typicalAmps, d.peakAmps, d.breakerAmps, d.notes, userId],
        );
        return { id: inserted.rows[0]!.id };
      }

      const updated = await client.query(
        `UPDATE power_loads SET name = $1, subsystem = $2, motor_count = $3, typical_amps = $4, peak_amps = $5,
           breaker_amps = $6, notes = $7, updated_at = now()
         WHERE id = $8 AND org_id = $9`,
        [d.name, d.subsystem, d.motorCount, d.typicalAmps, d.peakAmps, d.breakerAmps, d.notes, action.id, action.orgId],
      );
      if (!updated.rowCount) throw new HttpError(404, "Load not found");
      return { ok: true };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
