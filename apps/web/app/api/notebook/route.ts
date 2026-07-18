import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { parseNotebookAction, summarizeNotebook, type BuildPhase } from "../../../lib/notebook";

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
  return Response.json({ error: error instanceof Error ? error.message : "Notebook request failed" }, { status });
}

type EntryRow = {
  id: string; seasonYear: number; entryDate: string; phase: BuildPhase; subsystem: string;
  title: string; body: string; tags: string[]; byName: string | null; updatedAt: string;
};

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const subsystemFilter = url.searchParams.get("subsystem");

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
      if (!row) return { status: "setup_required" as const, message: "Select a team workspace to open the notebook." };

      const entries = await client.query<EntryRow>(
        `SELECT n.id, n.season_year AS "seasonYear", n.entry_date::text AS "entryDate", n.phase, n.subsystem,
                n.title, n.body, n.tags, u.name AS "byName", n.updated_at::text AS "updatedAt"
         FROM notebook_entries n LEFT JOIN users u ON u.id = n.author_user_id
         WHERE n.org_id = $1 AND ($2::text IS NULL OR n.subsystem = $2::text)
         ORDER BY n.entry_date DESC, n.created_at DESC
         LIMIT 300`,
        [row.orgId, subsystemFilter],
      );

      const summary = summarizeNotebook(
        entries.rows.map((e) => ({ subsystem: e.subsystem, phase: e.phase, entryDate: e.entryDate })),
      );

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        entries: entries.rows,
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
    const action = parseNotebookAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "create_entry": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO notebook_entries (org_id, season_year, entry_date, phase, subsystem, title, body, tags, author_user_id)
             VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8::text[], $9) RETURNING id`,
            [action.orgId, action.seasonYear, action.entryDate, action.phase, action.subsystem, action.title, action.body, action.tags, userId],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "update_entry": {
          const sets: string[] = [];
          const values: unknown[] = [];
          const add = (col: string, val: unknown, cast = "") => {
            values.push(val);
            sets.push(`${col} = $${values.length}${cast}`);
          };
          if (action.patch.title !== undefined) add("title", action.patch.title);
          if (action.patch.phase !== undefined) add("phase", action.patch.phase);
          if (action.patch.subsystem !== undefined) add("subsystem", action.patch.subsystem);
          if (action.patch.body !== undefined) add("body", action.patch.body);
          if (action.patch.tags !== undefined) add("tags", action.patch.tags, "::text[]");
          const updated = await client.query(
            `UPDATE notebook_entries SET ${sets.join(", ")}, updated_at = now() WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Entry not found");
          return { ok: true };
        }
        case "delete_entry": {
          const deleted = await client.query(`DELETE FROM notebook_entries WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this entry");
          return { ok: true };
        }
        default:
          throw new HttpError(400, "Unsupported notebook action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
