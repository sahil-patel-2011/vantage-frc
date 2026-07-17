import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseSoftwareVersionAction, summarizeVersions, versionStatus, type VersionCategory } from "../../../lib/software-versions";

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
  return Response.json({ error: error instanceof Error ? error.message : "Software version request failed" }, { status });
}

type ComponentRow = {
  id: string; component: string; category: VersionCategory; installedVersion: string;
  targetVersion: string | null; notes: string; byName: string | null; updatedAt: string;
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
      if (!row) return { status: "setup_required" as const, message: "Select a team workspace to track software versions." };

      const components = await client.query<ComponentRow>(
        `SELECT c.id, c.component, c.category, c.installed_version AS "installedVersion", c.target_version AS "targetVersion",
                c.notes, u.name AS "byName", c.updated_at::text AS "updatedAt"
         FROM software_versions c LEFT JOIN users u ON u.id = c.updated_by
         WHERE c.org_id = $1 AND c.season_year = $2 ORDER BY c.category, c.component`,
        [row.orgId, seasonYear],
      );

      const enriched = components.rows.map((c) => ({ ...c, status: versionStatus(c.installedVersion, c.targetVersion) }));
      const summary = summarizeVersions(components.rows.map((c) => ({ installedVersion: c.installedVersion, targetVersion: c.targetVersion })));

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        components: enriched,
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
    const action = parseSoftwareVersionAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      if (action.action === "delete_component") {
        const deleted = await client.query(`DELETE FROM software_versions WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
        if (!deleted.rowCount) throw new HttpError(404, "Component not found");
        return { ok: true };
      }

      const inserted = await client.query<{ id: string }>(
        `INSERT INTO software_versions (org_id, season_year, component, category, installed_version, target_version, notes, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (org_id, season_year, component) DO UPDATE SET
           category = excluded.category, installed_version = excluded.installed_version,
           target_version = excluded.target_version, notes = excluded.notes,
           updated_by = excluded.updated_by, updated_at = now()
         RETURNING id`,
        [action.orgId, action.seasonYear, action.component, action.category, action.installedVersion, action.targetVersion, action.notes, userId],
      );
      return { id: inserted.rows[0]!.id };
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
