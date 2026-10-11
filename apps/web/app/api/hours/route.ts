import type { PoolClient } from "@neondatabase/serverless";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";
import {
  describeSessionRange,
  overlapMessage,
  parseBuildHoursAction,
  type BuildHoursView,
  type HourLog,
  type HourPolicy,
} from "../../../lib/build-hours";
import {
  ENROLL_SCAN_SETUP_MESSAGE,
  canEnrollScanCodes,
  enrollConflictMessage,
  enrollSuccessPayload,
  isEnrollScanBody,
  isMissingScanCodeSchema,
  isScanCodeUniqueViolation,
  parseEnrollScanAction,
} from "../../../lib/hours/enroll";
import { sweepOpenSessions } from "../../../lib/hours/sweep";
import { publicErrorMessage, viewOnlyResponse } from "../../../lib/security/public-error";

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

/** The member's session that overlaps [clockIn, clockOut), if any; an open session runs until now. */
async function overlappingSession(
  client: PoolClient,
  input: { orgId: string; userId: string; clockIn: string; clockOut: string; excludeId: string | null },
): Promise<{ clockIn: string; clockOut: string | null } | null> {
  const result = await client.query<{ clockIn: string; clockOut: string | null }>(
    `SELECT clock_in::text AS "clockIn", clock_out::text AS "clockOut"
     FROM hour_logs
     WHERE org_id = $1::uuid AND user_id = $2::uuid
       AND ($5::uuid IS NULL OR id <> $5::uuid)
       AND clock_in < $4::timestamptz
       AND COALESCE(clock_out, now()) > $3::timestamptz
     ORDER BY clock_in
     LIMIT 1`,
    [input.orgId, input.userId, input.clockIn, input.clockOut, input.excludeId],
  );
  return result.rows[0] ?? null;
}

function fail(error: unknown) {
  // View only refusals are 403 + reason, everywhere (QA A3-18).
  const viewOnly = viewOnlyResponse(error);
  if (viewOnly) return viewOnly;
  const status = error instanceof HttpError ? error.status : 400;
  return Response.json({ error: publicErrorMessage(error, "Hours request failed") }, { status });
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
          message: "Choose your team to track build hours.",
          context: { orgId: null, orgName: null, teamNumber: null, role: null, userId: session.user.id },
        } satisfies BuildHoursView;
      }

      const [policyRows, records, members] = await Promise.all([
        client.query<HourPolicy>(
          `SELECT season_goal_hours::float8 AS "seasonGoalHours", season_start::text AS "seasonStart"
           FROM hour_policies WHERE org_id = $1`,
          [row.orgId],
        ),
        // entry_source and the correction columns arrive with 0723; reading them through
        // to_jsonb(r) keeps this list loading on a database that does not have them yet.
        client.query<HourLog>(
          `SELECT r.id, r.user_id AS "userId", u.name AS "userName", r.kind,
                  r.clock_in::text AS "clockIn", r.clock_out::text AS "clockOut", r.note,
                  cb.name AS "closedByName",
                  to_jsonb(r) ->> 'entry_source' AS "entrySource",
                  to_jsonb(r) ->> 'correction_note' AS "correctionNote",
                  to_jsonb(r) ->> 'corrected_at' AS "correctedAt",
                  cr.name AS "correctedByName"
           FROM hour_logs r
           JOIN users u ON u.id = r.user_id
           LEFT JOIN users cb ON cb.id = r.closed_by
           LEFT JOIN users cr ON cr.id::text = to_jsonb(r) ->> 'corrected_by'
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
    const body = await request.json();
    const userId = session.user.id;

    if (isEnrollScanBody(body)) {
      const enroll = parseEnrollScanAction(body);
      try {
        const result = await withRls({ userId, orgId: enroll.orgId }, async (client) => {
          const role = await membershipRole(client, enroll.orgId, userId);
          if (!canEnrollScanCodes(role)) {
            throw new HttpError(403, "Owner/admin access required to enroll a scan card");
          }
          const member = await client.query(
            `SELECT 1 FROM memberships WHERE org_id = $1::uuid AND user_id = $2::uuid`,
            [enroll.orgId, enroll.userId],
          );
          if (!member.rowCount) throw new HttpError(400, "That member is not in this organization");
          const existing = await client.query<{ userName: string | null }>(
            `SELECT u.name AS "userName" FROM member_scan_codes c
             JOIN users u ON u.id = c.user_id
             WHERE c.org_id = $1::uuid AND c.code = $2`,
            [enroll.orgId, enroll.code],
          );
          if (existing.rowCount) {
            throw new HttpError(409, enrollConflictMessage(existing.rows[0]!.userName));
          }
          try {
            const inserted = await client.query<{ id: string }>(
              `INSERT INTO member_scan_codes (org_id, user_id, code, code_kind, label, created_by)
               VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
               RETURNING id`,
              [enroll.orgId, enroll.userId, enroll.code, enroll.codeKind, enroll.label, userId],
            );
            return enrollSuccessPayload(inserted.rows[0]!.id, enroll.code);
          } catch (error) {
            if (isScanCodeUniqueViolation(error)) {
              throw new HttpError(409, enrollConflictMessage(null));
            }
            throw error;
          }
        });
        return Response.json(result);
      } catch (error) {
        if (isMissingScanCodeSchema(error)) {
          return Response.json({ error: ENROLL_SCAN_SETUP_MESSAGE }, { status: 503 });
        }
        return fail(error);
      }
    }

    const action = parseBuildHoursAction(body);

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
          // Two sessions at once would count the same hours twice on the leaderboard.
          const clash = await overlappingSession(client, {
            orgId: action.orgId,
            userId: targetUser,
            clockIn: action.clockIn,
            clockOut: action.clockOut,
            excludeId: null,
          });
          if (clash) throw new HttpError(409, overlapMessage(clash, action.timeZone));
          // 0723's trigger marks a session that arrives already closed as entry_source 'manual'.
          const inserted = await client.query<{ id: string }>(
            `INSERT INTO hour_logs (org_id, user_id, kind, clock_in, clock_out, note, created_by, closed_by)
             VALUES ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $7) RETURNING id`,
            [action.orgId, targetUser, action.kind, action.clockIn, action.clockOut, action.note, userId],
          );
          return { id: inserted.rows[0]!.id };
        }

        case "correct_record": {
          if (!isAdmin(role)) {
            throw new HttpError(403, "Only an owner or admin can change the times on an hours entry. Ask one to correct it.");
          }
          const target = await client.query<{ userId: string; clockIn: string; clockOut: string | null }>(
            `SELECT user_id AS "userId", clock_in::text AS "clockIn", clock_out::text AS "clockOut"
             FROM hour_logs WHERE id = $1::uuid AND org_id = $2::uuid`,
            [action.id, action.orgId],
          );
          const before = target.rows[0];
          if (!before) throw new HttpError(404, "That entry was deleted. Reload the page.");
          const clash = await overlappingSession(client, {
            orgId: action.orgId,
            userId: before.userId,
            clockIn: action.clockIn,
            clockOut: action.clockOut,
            excludeId: action.id,
          });
          if (clash) throw new HttpError(409, overlapMessage(clash, action.timeZone));
          // The note keeps the times it replaced, so the correction is its own audit trail.
          const note = `Was ${describeSessionRange(before.clockIn, before.clockOut, action.timeZone)}. ${action.note}`.slice(0, 500);
          try {
            await client.query(
              `UPDATE hour_logs
               SET clock_in = $3::timestamptz, clock_out = $4::timestamptz, closed_by = COALESCE(closed_by, $5::uuid),
                   corrected_by = $5::uuid, corrected_at = now(), correction_note = $6
               WHERE id = $1::uuid AND org_id = $2::uuid`,
              [action.id, action.orgId, action.clockIn, action.clockOut, userId, note],
            );
          } catch (error) {
            if ((error as { code?: string } | null)?.code === "42703") {
              throw new HttpError(503, "Correcting hours isn't switched on for your team yet. Delete the entry and add it again for now.");
            }
            throw error;
          }
          return { ok: true };
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
          // "End meeting" is a mentor attesting that everyone left now, so sessions from this
          // meeting close at now() with their real elapsed time. A session that was already open
          // past the policy cutoff was not part of this meeting — it was forgotten — so it is
          // capped and flagged instead of being credited the full overnight span.
          const swept = await sweepOpenSessions(client, {
            orgId: action.orgId,
            callerId: userId,
            attestedCloseAt: new Date(),
          });
          return {
            closed: swept.applied + swept.attested,
            capped: swept.applied,
            attested: swept.attested,
            policy: swept.policy,
            summary: swept.summary,
          };
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
