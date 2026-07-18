import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  parseCalendarAction,
  seedFromKickoff,
  type CalendarView,
  type Milestone,
} from "../../../lib/season-calendar";

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
  return Response.json({ error: error instanceof Error ? error.message : "Calendar request failed" }, { status });
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
          message: "Select a team workspace to plan your season calendar.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null },
        } satisfies CalendarView;
      }

      const milestones = await client.query<Milestone>(
        `SELECT s.id, s.title, s.kind, s.starts_on::text AS "startsOn", s.ends_on::text AS "endsOn",
                s.notes, s.meeting_url AS "meetingUrl",
                s.done, s.done_at::text AS "doneAt", db.name AS "doneByName", cb.name AS "createdByName"
         FROM season_milestones s
         LEFT JOIN users db ON db.id = s.done_by
         LEFT JOIN users cb ON cb.id = s.created_by
         WHERE s.org_id = $1
         ORDER BY s.starts_on, s.created_at
         LIMIT 500`,
        [row.orgId],
      );

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
        },
        milestones: milestones.rows,
      } satisfies CalendarView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseCalendarAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await requireMembership(client, action.orgId, userId);

      switch (action.action) {
        case "seed_season": {
          const existing = await client.query<{ title: string }>(
            `SELECT title FROM season_milestones WHERE org_id = $1`,
            [action.orgId],
          );
          const taken = new Set(existing.rows.map((existingRow) => existingRow.title));
          let added = 0;
          for (const seed of seedFromKickoff(action.kickoffDate)) {
            if (taken.has(seed.title)) continue;
            await client.query(
              `INSERT INTO season_milestones (org_id, title, kind, starts_on, created_by)
               VALUES ($1, $2, $3, $4, $5)`,
              [action.orgId, seed.title, seed.kind, seed.startsOn, userId],
            );
            added += 1;
          }
          return { added };
        }

        case "add_milestone": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO season_milestones (org_id, title, kind, starts_on, ends_on, notes, meeting_url, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
            [action.orgId, action.title, action.kind, action.startsOn, action.endsOn, action.notes, action.meetingUrl, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "update_milestone": {
          const values: unknown[] = [action.id, action.orgId];
          const sets: string[] = [];
          const push = (column: string, value: unknown) => {
            values.push(value);
            sets.push(`${column} = $${values.length}`);
          };
          const patch = action.patch;
          if (Object.prototype.hasOwnProperty.call(patch, "title")) push("title", patch.title);
          if (Object.prototype.hasOwnProperty.call(patch, "kind")) push("kind", patch.kind);
          if (Object.prototype.hasOwnProperty.call(patch, "startsOn")) push("starts_on", patch.startsOn);
          if (Object.prototype.hasOwnProperty.call(patch, "endsOn")) push("ends_on", patch.endsOn);
          if (Object.prototype.hasOwnProperty.call(patch, "notes")) push("notes", patch.notes);
          if (Object.prototype.hasOwnProperty.call(patch, "meetingUrl")) push("meeting_url", patch.meetingUrl);
          const updated = await client.query(
            `UPDATE season_milestones SET ${sets.join(", ")}, updated_at = now() WHERE id = $1 AND org_id = $2`,
            values,
          );
          if (!updated.rowCount) throw new HttpError(404, "Milestone not found");
          return { ok: true };
        }

        case "toggle_done": {
          const updated = await client.query(
            `UPDATE season_milestones
             SET done = $3,
                 done_at = CASE WHEN $3 THEN now() ELSE NULL END,
                 done_by = CASE WHEN $3 THEN $4::uuid ELSE NULL END,
                 updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            [action.id, action.orgId, action.done, userId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Milestone not found");
          return { ok: true };
        }

        case "delete_milestone": {
          const deleted = await client.query(`DELETE FROM season_milestones WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "Milestone not found");
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported calendar action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
