import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { DEFAULT_WEIGHT_LIMIT_LBS, parseWeightAction, summarizeWeight } from "../../../lib/weight-budget";

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
  return Response.json({ error: error instanceof Error ? error.message : "Weight budget request failed" }, { status });
}

type ComponentRow = { id: string; name: string; subsystem: string; weightLbs: number; quantity: number; notes: string; byName: string | null };

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
      if (!row) return { status: "setup_required" as const, message: "Select a team workspace to budget weight." };

      const [components, settings] = await Promise.all([
        client.query<ComponentRow>(
          `SELECT c.id, c.name, c.subsystem, c.weight_lbs::float8 AS "weightLbs", c.quantity, c.notes, u.name AS "byName"
           FROM weight_components c LEFT JOIN users u ON u.id = c.created_by
           WHERE c.org_id = $1 AND c.season_year = $2 ORDER BY c.subsystem, c.name`,
          [row.orgId, seasonYear],
        ),
        client.query<{ limitLbs: number }>(
          `SELECT limit_lbs::float8 AS "limitLbs" FROM weight_settings WHERE org_id = $1 AND season_year = $2`,
          [row.orgId, seasonYear],
        ),
      ]);

      const limitLbs = settings.rows[0]?.limitLbs ?? DEFAULT_WEIGHT_LIMIT_LBS;
      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        components: components.rows,
        summary: summarizeWeight(components.rows.map((c) => ({ subsystem: c.subsystem, weightLbs: c.weightLbs, quantity: c.quantity })), limitLbs),
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
    const action = parseWeightAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "set_limit": {
          await client.query(
            `INSERT INTO weight_settings (org_id, season_year, limit_lbs, updated_by)
             VALUES ($1,$2,$3,$4)
             ON CONFLICT (org_id, season_year) DO UPDATE SET limit_lbs = excluded.limit_lbs, updated_by = excluded.updated_by, updated_at = now()`,
            [action.orgId, action.seasonYear, action.limitLbs, userId],
          );
          return { ok: true };
        }
        case "delete_component": {
          const deleted = await client.query(`DELETE FROM weight_components WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this component");
          return { ok: true };
        }
        case "create_component": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO weight_components (org_id, season_year, name, subsystem, weight_lbs, quantity, notes, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
            [action.orgId, action.seasonYear, action.name, action.subsystem, action.weightLbs, action.quantity, action.notes, userId],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "update_component": {
          const d = action.patch;
          const updated = await client.query(
            `UPDATE weight_components SET name = $1, subsystem = $2, weight_lbs = $3, quantity = $4, notes = $5, updated_at = now()
             WHERE id = $6 AND org_id = $7`,
            [d.name, d.subsystem, d.weightLbs, d.quantity, d.notes, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Component not found");
          return { ok: true };
        }
        default:
          throw new HttpError(400, "Unsupported weight action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
