import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import { BRINGUP_TEMPLATE, computeProgress, parseBringupAction, type BringupPhase, type BringupResult } from "../../../lib/bringup";

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
  return Response.json({ error: error instanceof Error ? error.message : "Bring-up request failed" }, { status });
}

type ItemRow = { id: string; phase: BringupPhase; label: string; result: BringupResult; note: string; sortOrder: number };

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
      if (!row) return { status: "setup_required" as const, message: "Choose your team to run bring-up." };

      const items = await client.query<ItemRow>(
        `SELECT id, phase, label, result, note, sort_order AS "sortOrder"
         FROM bringup_items WHERE org_id = $1 AND season_year = $2 ORDER BY sort_order, label`,
        [row.orgId, seasonYear],
      );

      return {
        status: "ready" as const,
        context: { orgId: row.orgId, orgName: row.orgName, role: row.role },
        seasonYear,
        items: items.rows,
        progress: computeProgress(items.rows.map((i) => ({ result: i.result }))),
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
    const action = parseBringupAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "seed_template": {
          const existing = await client.query(`SELECT 1 FROM bringup_items WHERE org_id = $1 AND season_year = $2 LIMIT 1`, [action.orgId, action.seasonYear]);
          if (existing.rowCount) throw new HttpError(400, "The checklist is already set up for this season");
          for (const [index, item] of BRINGUP_TEMPLATE.entries()) {
            await client.query(
              `INSERT INTO bringup_items (org_id, season_year, phase, label, sort_order, created_by)
               VALUES ($1,$2,$3,$4,$5,$6)`,
              [action.orgId, action.seasonYear, item.phase, item.label, index, userId],
            );
          }
          return { seeded: BRINGUP_TEMPLATE.length };
        }
        case "add_item": {
          const order = await client.query<{ next: number }>(
            `SELECT COALESCE(max(sort_order), -1) + 1 AS next FROM bringup_items WHERE org_id = $1 AND season_year = $2`,
            [action.orgId, action.seasonYear],
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO bringup_items (org_id, season_year, phase, label, sort_order, created_by)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [action.orgId, action.seasonYear, action.phase, action.label, order.rows[0]!.next, userId],
          );
          return { id: inserted.rows[0]!.id };
        }
        case "set_result": {
          const updated = await client.query(
            `UPDATE bringup_items SET result = $1, note = COALESCE(NULLIF($2, ''), note), updated_at = now()
             WHERE id = $3 AND org_id = $4`,
            [action.result, action.note, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Item not found");
          return { ok: true };
        }
        case "delete_item": {
          const deleted = await client.query(`DELETE FROM bringup_items WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          if (!deleted.rowCount) throw new HttpError(404, "Item not found");
          return { ok: true };
        }
        default:
          throw new HttpError(400, "Unsupported bring-up action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
