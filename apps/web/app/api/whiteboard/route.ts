import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  defaultRobots,
  parseWhiteboardAction,
  type PlayPatch,
  type WhiteboardPlay,
  type WhiteboardView,
} from "../../../lib/whiteboard";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
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
  return Response.json({ error: error instanceof Error ? error.message : "Whiteboard request failed" }, { status });
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");

    const view = await withRls({ userId: session.user.id }, async (client) => {
      const membership = await client.query<{
        orgId: string;
        orgName: string;
        teamNumber: number | null;
        role: string;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Choose your team to open the strategy whiteboard.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null },
        } satisfies WhiteboardView;
      }

      const plays = await client.query<WhiteboardPlay>(
        `SELECT p.id, p.title, p.match_key AS "matchKey", p.description,
                p.strokes, p.robots, u.name AS "createdByName", p.updated_at::text AS "updatedAt"
         FROM whiteboard_plays p
         LEFT JOIN users u ON u.id = p.created_by
         WHERE p.org_id = $1
         ORDER BY p.updated_at DESC
         LIMIT 100`,
        [row.orgId],
      );

      return {
        status: "ready",
        context: { orgId: row.orgId, orgName: row.orgName, teamNumber: row.teamNumber, role: row.role },
        plays: plays.rows,
      } satisfies WhiteboardView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseWhiteboardAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "create_play": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO whiteboard_plays (org_id, title, match_key, robots, created_by)
             VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING id`,
            [action.orgId, action.title, action.matchKey, JSON.stringify(defaultRobots()), userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "update_play": {
          const { clause, values } = buildPlayUpdate(action.patch);
          const updated = await client.query(
            `UPDATE whiteboard_plays SET ${clause}, updated_at = now()
             WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Play not found");
          return { ok: true };
        }

        case "delete_play": {
          const deleted = await client.query(`DELETE FROM whiteboard_plays WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this play");
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported whiteboard action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}

function buildPlayUpdate(patch: PlayPatch) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };
  if (patch.title !== undefined) add("title", patch.title);
  if (patch.description !== undefined) add("description", patch.description);
  if (patch.matchKey !== undefined) add("match_key", patch.matchKey);
  if (patch.strokes !== undefined) add("strokes", JSON.stringify(patch.strokes), "::jsonb");
  if (patch.robots !== undefined) add("robots", JSON.stringify(patch.robots), "::jsonb");
  if (!sets.length) throw new HttpError(400, "No changes provided");
  return { clause: sets.join(", "), values };
}
