import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  defaultSeasonYear,
  parseAttendanceAction,
  type AttendanceEntry,
  type AttendanceEvent,
  type AttendanceView,
} from "../../../lib/attendance";

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

async function membershipRole(client: PoolClient, orgId: string, userId: string) {
  const row = await client.query<{ role: string }>(
    `SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`,
    [orgId, userId],
  );
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
  return row.rows[0]!.role;
}

const isAdmin = (role: string) => role === "owner" || role === "admin";

function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Attendance request failed";
  if (/attendance_|relation .* does not exist/i.test(message)) {
    return Response.json(
      { error: "Apply the Team Attendance migration first (0047_attendance)." },
      { status: 503 },
    );
  }
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: message }, { status });
}

async function loadEvents(client: PoolClient, orgId: string, seasonYear: number): Promise<AttendanceEvent[]> {
  const events = await client.query<{
    id: string;
    title: string;
    kind: AttendanceEvent["kind"];
    occurredOn: string;
    creditHours: number;
    seasonYear: number;
    createdByName: string | null;
  }>(
    `SELECT e.id, e.title, e.kind, e.occurred_on::text AS "occurredOn",
            e.credit_hours::float8 AS "creditHours", e.season_year AS "seasonYear",
            u.name AS "createdByName"
     FROM attendance_events e
     JOIN users u ON u.id = e.created_by
     WHERE e.org_id = $1 AND e.season_year = $2
     ORDER BY e.occurred_on DESC, e.created_at DESC
     LIMIT 300`,
    [orgId, seasonYear],
  );

  if (!events.rowCount) return [];

  const ids = events.rows.map((row) => row.id);
  const entries = await client.query<AttendanceEntry>(
    `SELECT a.id, a.event_id AS "eventId", a.person_name AS "personName", a.role,
            a.hours::float8 AS hours, a.created_at::text AS "createdAt"
     FROM attendance_entries a
     WHERE a.org_id = $1 AND a.event_id = ANY($2::uuid[])
     ORDER BY a.person_name ASC, a.created_at ASC`,
    [orgId, ids],
  );

  const byEvent = new Map<string, AttendanceEntry[]>();
  for (const entry of entries.rows) {
    const list = byEvent.get(entry.eventId) ?? [];
    list.push(entry);
    byEvent.set(entry.eventId, list);
  }

  return events.rows.map((row) => ({
    ...row,
    entries: byEvent.get(row.id) ?? [],
  }));
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    const seasonParam = url.searchParams.get("seasonYear");
    const seasonYear = seasonParam ? Number(seasonParam) : defaultSeasonYear();
    if (!Number.isInteger(seasonYear) || seasonYear < 1992 || seasonYear > 3000) {
      throw new HttpError(400, "Season year is invalid");
    }

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
          message: "Select a team workspace to track practice and meeting attendance.",
          context: {
            orgId: null,
            orgName: null,
            teamNumber: null,
            role: null,
            userId: session.user.id,
            canManage: false,
          },
        } satisfies AttendanceView;
      }

      const [events, seasonRows] = await Promise.all([
        loadEvents(client, row.orgId, seasonYear),
        client.query<{ seasonYear: number }>(
          `SELECT DISTINCT season_year AS "seasonYear"
           FROM attendance_events WHERE org_id = $1
           ORDER BY season_year DESC`,
          [row.orgId],
        ),
      ]);

      const seasons = [...new Set([seasonYear, ...seasonRows.rows.map((r) => r.seasonYear)])].sort(
        (a, b) => b - a,
      );

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
          userId: session.user.id,
          canManage: isAdmin(row.role),
        },
        events,
        seasonYear,
        seasons,
      } satisfies AttendanceView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseAttendanceAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      const role = await membershipRole(client, action.orgId, userId);
      if (!isAdmin(role)) throw new HttpError(403, "Owner/admin access required to manage attendance");

      switch (action.action) {
        case "create_event": {
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO attendance_events
               (org_id, title, kind, occurred_on, credit_hours, season_year, created_by)
             VALUES ($1, $2, $3, $4::date, $5, $6, $7)
             RETURNING id`,
            [
              action.orgId,
              action.title,
              action.kind,
              action.occurredOn,
              action.creditHours,
              action.seasonYear,
              userId,
            ],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "update_event": {
          const updated = await client.query(
            `UPDATE attendance_events
             SET title = $3, kind = $4, occurred_on = $5::date, credit_hours = $6,
                 season_year = $7, updated_at = now()
             WHERE id = $1 AND org_id = $2`,
            [
              action.id,
              action.orgId,
              action.title,
              action.kind,
              action.occurredOn,
              action.creditHours,
              action.seasonYear,
            ],
          );
          if (!updated.rowCount) throw new HttpError(404, "Attendance event not found");
          return { ok: true };
        }

        case "delete_event": {
          const deleted = await client.query(`DELETE FROM attendance_events WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "Attendance event not found");
          return { ok: true };
        }

        case "add_entry": {
          const event = await client.query(`SELECT 1 FROM attendance_events WHERE id = $1 AND org_id = $2`, [
            action.eventId,
            action.orgId,
          ]);
          if (!event.rowCount) throw new HttpError(404, "Attendance event not found");
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO attendance_entries (org_id, event_id, person_name, role, hours)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [action.orgId, action.eventId, action.personName, action.role, action.hours],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "delete_entry": {
          const deleted = await client.query(`DELETE FROM attendance_entries WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(404, "Attendance entry not found");
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported attendance action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
