import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { DEFAULT_WEIGHT_LIMIT_LBS, summarizeWeight } from "../../../lib/weight-budget";
import { parseWeightWrite, plannedLineSaveFromWrite, upsertPlannedLine } from "../../../lib/weight-budget/upsert";

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
      if (!row) return { status: "setup_required" as const, message: "Choose your team to budget weight." };

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
    const action = parseWeightWrite(await request.json());
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
        case "create_component":
        case "upsert_component":
        case "update_component":
          return upsertPlannedLine(client, plannedLineSaveFromWrite(action, userId));
        default:
          throw new HttpError(400, "Unsupported weight action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
