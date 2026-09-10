import type { PoolClient, QueryResultRow } from "@neondatabase/serverless";
import { auth, resolveAuthBaseURL, sendPracticeReminderEmail } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  parseDriverPracticeAction,
  type CyclePatch,
  type DriverCycle,
  type DriverPracticeView,
  type DriverSession,
  type LinkableAttendance,
  type LinkableBuildTask,
  type SessionPatch,
} from "../../../lib/driver-practice";

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
  const row = await client.query(`SELECT 1 FROM memberships WHERE org_id = $1 AND user_id = $2 LIMIT 1`, [orgId, userId]);
  if (!row.rowCount) throw new HttpError(403, "Organization membership required");
}

/** Soft-fail when a linked Team module table is not migrated yet. */
async function optionalQuery<T extends QueryResultRow>(client: PoolClient, sql: string, params: unknown[]): Promise<T[]> {
  try {
    const result = await client.query<T>(sql, params);
    return result.rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/does not exist|undefined_table/i.test(message)) return [];
    throw error;
  }
}

function fail(error: unknown) {
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Practice request failed" }, { status });
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
        eventKey: string | null;
      }>(
        `SELECT m.org_id AS "orgId", o.name AS "orgName", o.team_number AS "teamNumber", m.role,
                c.active_event_key AS "eventKey"
         FROM memberships m
         JOIN organizations o ON o.id = m.org_id
         LEFT JOIN org_active_context c ON c.org_id = o.id
         WHERE m.user_id = $1 AND ($2::uuid IS NULL OR m.org_id = $2::uuid)
         ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, o.team_number
         LIMIT 1`,
        [session.user.id, requestedOrg],
      );

      const row = membership.rows[0];
      if (!row) {
        return {
          status: "setup_required",
          message: "Choose your team to plan practice sessions.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null, eventKey: null },
        } satisfies DriverPracticeView;
      }

      const [sessionRows, cycles, members, attendanceEvents, buildTasks] = await Promise.all([
        client.query<
          Omit<DriverSession, "cycles" | "attendanceEventTitle" | "attendanceOccurredOn" | "buildTaskTitle">
        >(
          `SELECT s.id, s.title, s.event_key AS "eventKey", s.session_date::text AS "sessionDate",
                  s.driver_user_id AS "driverUserId", s.driver_name AS "driverName",
                  s.location, s.goal, s.notes,
                  s.attendance_event_id AS "attendanceEventId",
                  s.build_task_id AS "buildTaskId",
                  s.created_at::text AS "createdAt", s.updated_at::text AS "updatedAt"
           FROM driver_sessions s
           WHERE s.org_id = $1
           ORDER BY s.session_date DESC, s.created_at DESC`,
          [row.orgId],
        ),
        client.query<DriverCycle>(
          `SELECT c.id, c.session_id AS "sessionId", c.action, c.seconds::float8 AS seconds, c.success,
                  c.note, c.rep_index AS "repIndex", c.created_at::text AS "createdAt"
           FROM driver_cycles c
           WHERE c.org_id = $1
           ORDER BY c.session_id, c.rep_index, c.created_at`,
          [row.orgId],
        ),
        client.query<{ userId: string; name: string | null }>(
          `SELECT u.id AS "userId", u.name FROM memberships m JOIN users u ON u.id = m.user_id
           WHERE m.org_id = $1 ORDER BY u.name ASC NULLS LAST`,
          [row.orgId],
        ),
        optionalQuery<LinkableAttendance>(
          client,
          `SELECT id, title, occurred_on::text AS "occurredOn", kind
           FROM attendance_events
           WHERE org_id = $1 AND occurred_on >= (current_date - interval '60 days')
           ORDER BY occurred_on DESC, created_at DESC
           LIMIT 40`,
          [row.orgId],
        ),
        optionalQuery<LinkableBuildTask>(
          client,
          `SELECT id, title, status, subsystem
           FROM build_tasks
           WHERE org_id = $1 AND status = ANY($2::text[])
           ORDER BY
             CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
             due_on NULLS LAST, updated_at DESC
           LIMIT 40`,
          [row.orgId, ["todo", "in_progress", "blocked"]],
        ),
      ]);

      const linkedAttendanceIds = [
        ...new Set(
          sessionRows.rows
            .map((sessionRow) => sessionRow.attendanceEventId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const linkedAttendance = linkedAttendanceIds.length
        ? await optionalQuery<{ id: string; title: string; occurredOn: string }>(
            client,
            `SELECT id, title, occurred_on::text AS "occurredOn"
             FROM attendance_events
             WHERE org_id = $1 AND id = ANY($2::uuid[])`,
            [row.orgId, linkedAttendanceIds],
          )
        : [];

      const bySession = new Map<string, DriverCycle[]>();
      for (const cycle of cycles.rows) {
        const list = bySession.get(cycle.sessionId) ?? [];
        list.push(cycle);
        bySession.set(cycle.sessionId, list);
      }
      const attendanceById = new Map(linkedAttendance.map((event) => [event.id, event]));
      // Prefer picker rows (includes kind) when present; fall back to linked lookup for older events.
      for (const event of attendanceEvents) {
        if (!attendanceById.has(event.id)) {
          attendanceById.set(event.id, { id: event.id, title: event.title, occurredOn: event.occurredOn });
        }
      }
      const taskTitle = new Map(buildTasks.map((task) => [task.id, task.title]));

      return {
        status: "ready",
        context: {
          orgId: row.orgId,
          orgName: row.orgName,
          teamNumber: row.teamNumber,
          role: row.role,
          eventKey: row.eventKey,
        },
        sessions: sessionRows.rows.map((sessionRow) => {
          const linked = sessionRow.attendanceEventId
            ? attendanceById.get(sessionRow.attendanceEventId)
            : undefined;
          return {
            ...sessionRow,
            attendanceEventTitle: linked?.title ?? null,
            attendanceOccurredOn: linked?.occurredOn ?? null,
            buildTaskTitle: sessionRow.buildTaskId ? (taskTitle.get(sessionRow.buildTaskId) ?? null) : null,
            cycles: bySession.get(sessionRow.id) ?? [],
          };
        }),
        members: members.rows,
        attendanceEvents,
        buildTasks,
      } satisfies DriverPracticeView;
    });

    return Response.json(view);
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const action = parseDriverPracticeAction(await request.json());
    const userId = session.user.id;

    const result = await withRls({ userId, orgId: action.orgId }, async (client) => {
      await membershipRole(client, action.orgId, userId);

      switch (action.action) {
        case "create_session": {
          const inserted = await client.query<{ id: string; sessionDate: string }>(
            `INSERT INTO driver_sessions
               (org_id, title, event_key, session_date, driver_user_id, driver_name, location, goal, notes,
                attendance_event_id, build_task_id, created_by)
             VALUES ($1, $2, $3, COALESCE($4::date, current_date), $5::uuid, $6, $7, $8, $9, $10::uuid, $11::uuid, $12)
             RETURNING id, session_date::text AS "sessionDate"`,
            [
              action.orgId,
              action.title,
              action.eventKey,
              action.sessionDate,
              action.driverUserId,
              action.driverName,
              action.location,
              action.goal,
              action.notes,
              action.attendanceEventId,
              action.buildTaskId,
              userId,
            ],
          );
          const sessionId = inserted.rows[0]!.id;
          if (action.driverUserId) {
            const org = await client.query<{ name: string }>(`SELECT name FROM organizations WHERE id = $1`, [
              action.orgId,
            ]);
            await sendPracticeReminderEmail(client, {
              userId: action.driverUserId,
              orgName: org.rows[0]?.name ?? "Your team",
              sessionTitle: action.title,
              sessionDate: inserted.rows[0]!.sessionDate,
              location: action.location ?? undefined,
          href: `${resolveAuthBaseURL()}/team?tab=practice&orgId=${encodeURIComponent(action.orgId)}`,
            });
          }
          return { id: sessionId };
        }

        case "update_session": {
          const { clause, values } = buildSessionUpdate(action.patch);
          const updated = await client.query(
            `UPDATE driver_sessions SET ${clause}, updated_at = now()
             WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Session not found");
          return { ok: true };
        }

        case "delete_session": {
          const deleted = await client.query(`DELETE FROM driver_sessions WHERE id = $1 AND org_id = $2`, [
            action.id,
            action.orgId,
          ]);
          if (!deleted.rowCount) throw new HttpError(403, "You cannot delete this session");
          return { ok: true };
        }

        case "add_cycle": {
          const next = await client.query<{ next: number }>(
            `SELECT COALESCE(MAX(rep_index) + 1, 0) AS next FROM driver_cycles WHERE session_id = $1`,
            [action.sessionId],
          );
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO driver_cycles (org_id, session_id, action, seconds, success, note, rep_index, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id`,
            [
              action.orgId,
              action.sessionId,
              action.cycleAction,
              action.seconds,
              action.success,
              action.note,
              next.rows[0]?.next ?? 0,
              userId,
            ],
          );
          await touchSession(client, action.orgId, action.sessionId);
          return { id: inserted.rows[0]!.id };
        }

        case "update_cycle": {
          const { clause, values } = buildCycleUpdate(action.patch);
          const updated = await client.query<{ sessionId: string }>(
            `UPDATE driver_cycles SET ${clause}
             WHERE id = $${values.length + 1} AND org_id = $${values.length + 2}
             RETURNING session_id AS "sessionId"`,
            [...values, action.id, action.orgId],
          );
          if (!updated.rowCount) throw new HttpError(404, "Cycle not found");
          await touchSession(client, action.orgId, updated.rows[0]!.sessionId);
          return { ok: true };
        }

        case "delete_cycle": {
          const deleted = await client.query<{ sessionId: string }>(
            `DELETE FROM driver_cycles WHERE id = $1 AND org_id = $2 RETURNING session_id AS "sessionId"`,
            [action.id, action.orgId],
          );
          if (!deleted.rowCount) throw new HttpError(404, "Cycle not found");
          await touchSession(client, action.orgId, deleted.rows[0]!.sessionId);
          return { ok: true };
        }

        default:
          throw new HttpError(400, "Unsupported practice action");
      }
    });

    return Response.json(result);
  } catch (error) {
    return fail(error);
  }
}

async function touchSession(client: PoolClient, orgId: string, sessionId: string) {
  await client.query(`UPDATE driver_sessions SET updated_at = now() WHERE id = $1 AND org_id = $2`, [sessionId, orgId]);
}

function buildSessionUpdate(patch: SessionPatch) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown, cast = "") => {
    values.push(value);
    sets.push(`${column} = $${values.length}${cast}`);
  };
  if (patch.title !== undefined) add("title", patch.title);
  if (patch.eventKey !== undefined) add("event_key", patch.eventKey);
  if (patch.sessionDate !== undefined) add("session_date", patch.sessionDate, "::date");
  if (patch.driverUserId !== undefined) add("driver_user_id", patch.driverUserId, "::uuid");
  if (patch.driverName !== undefined) add("driver_name", patch.driverName);
  if (patch.location !== undefined) add("location", patch.location);
  if (patch.goal !== undefined) add("goal", patch.goal);
  if (patch.notes !== undefined) add("notes", patch.notes);
  if (patch.attendanceEventId !== undefined) add("attendance_event_id", patch.attendanceEventId, "::uuid");
  if (patch.buildTaskId !== undefined) add("build_task_id", patch.buildTaskId, "::uuid");
  if (!sets.length) throw new HttpError(400, "No changes provided");
  return { clause: sets.join(", "), values };
}

function buildCycleUpdate(patch: CyclePatch) {
  const sets: string[] = [];
  const values: unknown[] = [];
  const add = (column: string, value: unknown) => {
    values.push(value);
    sets.push(`${column} = $${values.length}`);
  };
  if (patch.action !== undefined) add("action", patch.action);
  if (patch.seconds !== undefined) add("seconds", patch.seconds);
  if (patch.success !== undefined) add("success", patch.success);
  if (patch.note !== undefined) add("note", patch.note);
  if (!sets.length) throw new HttpError(400, "No changes provided");
  return { clause: sets.join(", "), values };
}
