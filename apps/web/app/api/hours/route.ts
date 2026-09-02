import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  parseBuildHoursAction,
  type BuildHoursView,
  type HourLog,
  type HourPolicy,
} from "../../../lib/build-hours";
import {
  buildHoursCsv,
  hoursExportFileName,
  parseHoursExportRange,
  type HoursExportLog,
} from "../../../lib/hours/export-csv";

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
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Hours request failed" }, { status });
}

/**
 * `GET /api/hours?export=csv&orgId=…&userId=…&from=YYYY-MM-DD&to=YYYY-MM-DD`
 * Per-member CSV of real hour_logs rows. Any member exports their own hours;
 * an owner/admin may export any member's. Nothing is aggregated or invented —
 * open sessions export with no clock_out, auto-closed ones are flagged.
 */
async function exportCsv(request: Request, sessionUserId: string) {
  const url = new URL(request.url);
  const requestedOrg = url.searchParams.get("orgId");
  const targetParam = url.searchParams.get("userId");
  const range = parseHoursExportRange(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!range) throw new HttpError(400, "from/to must be YYYY-MM-DD and from must not be after to");

  const result = await withRls({ userId: sessionUserId, orgId: requestedOrg ?? undefined }, async (client) => {
    const membership = await client.query<{ orgId: string; role: string }>(
      `SELECT m.org_id AS "orgId", m.role::text AS role
       FROM memberships m
       JOIN organizations o ON o.id = m.org_id
       WHERE m.user_id = $1::uuid AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
       LIMIT 1`,
      [sessionUserId, requestedOrg],
    );
    const row = membership.rows[0];
    if (!row) throw new HttpError(403, "Organization membership required");

    const targetUser = targetParam && targetParam !== "me" ? targetParam : sessionUserId;
    if (targetUser !== sessionUserId && !isAdmin(row.role)) {
      throw new HttpError(403, "Owner/admin access required to export another member's hours");
    }
    const target = await client.query<{ name: string | null }>(
      `SELECT u.name FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1::uuid AND m.user_id = $2::uuid`,
      [row.orgId, targetUser],
    );
    if (!target.rowCount) throw new HttpError(404, "That member is not in this organization");

    const logs = await client.query<HoursExportLog>(
      `SELECT r.id, r.kind, r.clock_in::text AS "clockIn", r.clock_out::text AS "clockOut", r.note,
              r.auto_closed AS "autoClosed", r.auto_closed_reason AS "autoClosedReason",
              e.title AS "linkedEventTitle", r.occurrence_date::text AS "occurrenceDate"
       FROM hour_logs r
       LEFT JOIN subteam_calendar_events e ON e.id = r.calendar_event_id AND e.org_id = r.org_id
       WHERE r.org_id = $1::uuid AND r.user_id = $2::uuid
         AND ($3::date IS NULL OR r.clock_in >= $3::date)
         AND ($4::date IS NULL OR r.clock_in < ($4::date + interval '1 day'))
       ORDER BY r.clock_in ASC
       LIMIT 5000`,
      [row.orgId, targetUser, range.from, range.to],
    );
    return { csv: buildHoursCsv(logs.rows), memberName: target.rows[0]!.name };
  });

  return new Response(result.csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${hoursExportFileName({ memberName: result.memberName, range })}"`,
      "cache-control": "private, no-store",
    },
  });
}

export async function GET(request: Request) {
  try {
    const session = await requireSession();
    const url = new URL(request.url);
    const requestedOrg = url.searchParams.get("orgId");
    if (url.searchParams.get("export") === "csv") return await exportCsv(request, session.user.id);

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
          message: "Select a team workspace to track build hours.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null, userId: session.user.id },
        } satisfies BuildHoursView;
      }

      const [policyRows, records, members] = await Promise.all([
        client.query<HourPolicy>(
          `SELECT season_goal_hours::float8 AS "seasonGoalHours", season_start::text AS "seasonStart"
           FROM hour_policies WHERE org_id = $1`,
          [row.orgId],
        ),
        client.query<HourLog>(
          `SELECT r.id, r.user_id AS "userId", u.name AS "userName", r.kind,
                  r.clock_in::text AS "clockIn", r.clock_out::text AS "clockOut", r.note,
                  cb.name AS "closedByName"
           FROM hour_logs r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN users cb ON cb.id = r.closed_by
           WHERE r.org_id = $1
             AND (
               r.clock_out IS NULL
               OR r.clock_in >= COALESCE(
                    (SELECT season_start::timestamptz FROM hour_policies p WHERE p.org_id = $1),
                    now() - interval '400 days'
                  )
             )
           ORDER BY r.clock_in DESC
           LIMIT 2000`,
          [row.orgId],
        ),
        client.query<{ userId: string; name: string | null; role: string }>(
          `SELECT u.id AS "userId", u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.org_id = $1 ORDER BY u.name ASC NULLS LAST`,
          [row.orgId],
        ),
      ]);

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
          userId: session.user.id,
        },
        records: records.rows,
        policy: policyRows.rows[0] ?? { seasonGoalHours: 0, seasonStart: null },
        members: members.rows,
      } satisfies BuildHoursView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseBuildHoursAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      const role = await membershipRole(client, action.orgId, userId);

      switch (action.action) {
        case "clock_in": {
          // Kiosk mode: owner/admin devices may clock in another member.
          const targetUser = action.userId ?? userId;
          if (targetUser !== userId) {
            if (!isAdmin(role)) throw new HttpError(403, "Owner/admin access required to clock in another member");
            const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
              action.orgId,
              targetUser,
            ]);
            if (!member.rowCount) throw new HttpError(400, "That member is not in this organization");
          }
          const open = await client.query(
            `SELECT 1 FROM hour_logs WHERE org_id = $1 AND user_id = $2 AND clock_out IS NULL`,
            [action.orgId, targetUser],
          );
          if (open.rowCount) throw new HttpError(400, targetUser === userId ? "You are already clocked in" : "That member is already clocked in");
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO hour_logs (org_id, user_id, kind, note, created_by)
             VALUES ($1, $2, $3, $4, $5) RETURNING id`,
            [action.orgId, targetUser, action.kind, action.note, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "clock_out": {
          // Self clock-out (no recordId) closes the caller's open session; a
          // specific recordId lets an owner/admin sign someone else out.
          if (action.recordId) {
            const target = await client.query<{ userId: string }>(
              `SELECT user_id AS "userId" FROM hour_logs
               WHERE id = $1 AND org_id = $2 AND clock_out IS NULL`,
              [action.recordId, action.orgId],
            );
            if (!target.rowCount) throw new HttpError(404, "Open session not found");
            if (target.rows[0]!.userId !== userId && !isAdmin(role)) {
              throw new HttpError(403, "Owner/admin access required to sign out another member");
            }
            await client.query(
              `UPDATE hour_logs
               SET clock_out = now(), closed_by = $3, note = COALESCE(NULLIF($4, ''), note)
               WHERE id = $1 AND org_id = $2 AND clock_out IS NULL`,
              [action.recordId, action.orgId, userId, action.note ?? ""],
            );
            return { ok: true };
          }
          const updated = await client.query(
            `UPDATE hour_logs
             SET clock_out = now(), closed_by = $2, note = COALESCE(NULLIF($3, ''), note)
             WHERE org_id = $1 AND user_id = $2 AND clock_out IS NULL`,
            [action.orgId, userId, action.note ?? ""],
          );
          if (!updated.rowCount) throw new HttpError(400, "You are not clocked in");
          return { ok: true };
        }

        case "add_manual": {
          const targetUser = action.userId ?? userId;
          if (targetUser !== userId && !isAdmin(role)) {
            throw new HttpError(403, "Owner/admin access required to log hours for another member");
          }
          if (targetUser !== userId) {
            const member = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2`, [
              action.orgId,
              targetUser,
            ]);
            if (!member.rowCount) throw new HttpError(400, "That member is not in this organization");
          }
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO hour_logs (org_id, user_id, kind, clock_in, clock_out, note, created_by, closed_by)
             VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $7) RETURNING id`,
            [action.orgId, targetUser, action.kind, action.clockIn, action.clockOut, action.note, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "delete_record": {
          const target = await client.query<{ userId: string }>(
            `SELECT user_id AS "userId" FROM hour_logs WHERE id = $1 AND org_id = $2`,
            [action.id, action.orgId],
          );
          if (!target.rowCount) throw new HttpError(404, "Record not found");
          if (target.rows[0]!.userId !== userId && !isAdmin(role)) {
            throw new HttpError(403, "Owner/admin access required to delete another member's record");
          }
          await client.query(`DELETE FROM hour_logs WHERE id = $1 AND org_id = $2`, [action.id, action.orgId]);
          return { ok: true };
        }

        case "close_all_open": {
          if (!isAdmin(role)) throw new HttpError(403, "Owner/admin access required");
          const updated = await client.query(
            `UPDATE hour_logs SET clock_out = now(), closed_by = $2
             WHERE org_id = $1 AND clock_out IS NULL`,
            [action.orgId, userId],
          );
          return { closed: updated.rowCount ?? 0 };
        }

        case "set_policy": {
          if (!isAdmin(role)) throw new HttpError(403, "Owner/admin access required");
          await client.query(
            `INSERT INTO hour_policies (org_id, season_goal_hours, season_start, updated_by, updated_at)
             VALUES ($1, $2, $3::date, $4, now())
             ON CONFLICT (org_id) DO UPDATE SET
               season_goal_hours = excluded.season_goal_hours,
               season_start = excluded.season_start,
               updated_by = excluded.updated_by,
               updated_at = now()`,
            [action.orgId, action.seasonGoalHours, action.seasonStart, userId],
          );
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported hours action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}
